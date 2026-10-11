import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class ScoreSheetScreen extends StatefulWidget {
  final Fixture fixture;

  const ScoreSheetScreen({Key? key, required this.fixture}) : super(key: key);

  @override
  State<ScoreSheetScreen> createState() => _ScoreSheetScreenState();
}

class _ScoreSheetScreenState extends State<ScoreSheetScreen> with TickerProviderStateMixin {
  final _api = ApiService();
  final _socket = SocketService();

  int _activeSet = 1;
  int _p1Score = 0;
  int _p2Score = 0;
  bool _isSetLocked = false;
  bool _isLoading = true;

  // ICF Shot Clock (15s)
  int _shotClockSeconds = 15;
  bool _shotClockRunning = false;
  Timer? _shotClockTimer;

  // Board Coins Tracker
  int _whiteCoins = 9;
  int _blackCoins = 9;
  String _queenState = 'in_play';
  int _fouls = 0;

  // Floating Reactions
  final List<_FloatingReaction> _reactions = [];
  StreamSubscription? _socketSub;

  @override
  void initState() {
    super.initState();
    _loadScoreboard();
    _initSocket();
  }

  void _initSocket() {
    _socketSub = _socket.events.listen((event) {
      if (!mounted) return;
      if (event['fixtureId'] != widget.fixture.fixtureId) return;

      final type = event['type'];
      if (type == 'SPECTATOR_REACTION') {
        _addFloatingReaction(event['emoji'] ?? '👏');
      } else if (type == 'SHOT_CLOCK_SYNC') {
        setState(() {
          _shotClockSeconds = event['timeLeft'] ?? 15;
          _shotClockRunning = event['isRunning'] ?? false;
        });
      } else if (type == 'BOARD_COINS_SYNC') {
        setState(() {
          _whiteCoins = event['whiteCoins'] ?? 9;
          _blackCoins = event['blackCoins'] ?? 9;
          _queenState = event['queenState'] ?? 'in_play';
          _fouls = event['fouls'] ?? 0;
        });
      } else if (type == 'SCORE_UPDATE') {
        setState(() {
          _p1Score = event['player_1_points'] ?? _p1Score;
          _p2Score = event['player_2_points'] ?? _p2Score;
        });
      } else if (type == 'SET_LOCKED') {
        _loadScoreboard();
      }
    });
  }

  @override
  void dispose() {
    _shotClockTimer?.cancel();
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _loadScoreboard() async {
    setState(() => _isLoading = true);
    try {
      final data = await _api.getScoreboard(widget.fixture.fixtureId);
      final scores = (data['scores'] as List?) ?? [];
      final currentSet = scores.firstWhere(
        (s) => s['set_number'] == _activeSet,
        orElse: () => {
          'player_1_points': 0,
          'player_2_points': 0,
          'is_locked': false,
        },
      );

      setState(() {
        _p1Score = currentSet['player_1_points'] ?? 0;
        _p2Score = currentSet['player_2_points'] ?? 0;
        _isSetLocked = currentSet['is_locked'] == 1 || currentSet['is_locked'] == true;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  // --- ICF Shot Clock Controls ---

  void _toggleShotClock() {
    if (_shotClockRunning) {
      _shotClockTimer?.cancel();
      setState(() => _shotClockRunning = false);
      _broadcastShotClock();
    } else {
      setState(() => _shotClockRunning = true);
      _broadcastShotClock();

      _shotClockTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return;
        if (_shotClockSeconds <= 1) {
          timer.cancel();
          setState(() {
            _shotClockSeconds = 0;
            _shotClockRunning = false;
          });
          _broadcastShotClock();
        } else {
          setState(() => _shotClockSeconds--);
          if (_shotClockSeconds % 3 == 0) _broadcastShotClock();
        }
      });
    }
  }

  void _resetShotClock() {
    _shotClockTimer?.cancel();
    setState(() {
      _shotClockSeconds = 15;
      _shotClockRunning = false;
    });
    _broadcastShotClock();
  }

  void _broadcastShotClock() {
    _socket.sendShotClock(widget.fixture.fixtureId, _shotClockSeconds, _shotClockRunning);
  }

  // --- Coin Scoring & Sound ---

  Future<void> _submitScore(String player, int delta, String action) async {
    if (_isSetLocked) return;

    try {
      final res = await _api.postScoreEvent(
        fixtureId: widget.fixture.fixtureId,
        setNumber: _activeSet,
        player: player,
        pointDelta: delta,
        carromAction: action,
      );

      setState(() {
        _p1Score = res['player_1_points'] ?? _p1Score;
        _p2Score = res['player_2_points'] ?? _p2Score;

        if (action.contains('White')) {
          _whiteCoins = max(0, _whiteCoins - 1);
        } else if (action.contains('Black')) {
          _blackCoins = max(0, _blackCoins - 1);
        } else if (action.contains('Queen')) {
          _queenState = 'captured';
        } else if (action.contains('Due')) {
          _fouls++;
        }
      });

      // Reset turn shot clock
      _resetShotClock();

      // Sync coins over websocket
      _socket.sendBoardCoins(
        fixtureId: widget.fixture.fixtureId,
        whiteCoins: _whiteCoins,
        blackCoins: _blackCoins,
        queenState: _queenState,
        fouls: _fouls,
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to update score: $e')),
      );
    }
  }

  Future<void> _lockSet() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF062B20),
        title: Text('Finalize Set $_activeSet?'),
        content: const Text(
          'Once locked, referee scoring is disabled. Only the Organizer can unlock this set.',
          style: TextStyle(color: Colors.white70, fontSize: 13),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF059669)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Lock Set'),
          ),
        ],
      ),
    );

    if (ok == true) {
      final success = await _api.lockSet(widget.fixture.fixtureId, _activeSet);
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Set $_activeSet locked successfully!')),
        );
        _loadScoreboard();
      }
    }
  }

  void _sendReaction(String emoji) {
    _socket.sendReaction(widget.fixture.fixtureId, emoji);
    _addFloatingReaction(emoji);
  }

  void _addFloatingReaction(String emoji) {
    final reaction = _FloatingReaction(
      id: UniqueKey().toString(),
      emoji: emoji,
      startX: Random().nextDouble() * 0.7 + 0.15,
    );
    setState(() => _reactions.add(reaction));

    Future.delayed(const Duration(milliseconds: 2200), () {
      if (mounted) {
        setState(() => _reactions.removeWhere((r) => r.id == reaction.id));
      }
    });
  }

  void _openDisputeDialog() {
    final reasonController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF062B20),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.redAccent),
            SizedBox(width: 8),
            Text('Raise Match Dispute', style: TextStyle(color: Colors.white, fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Halts match progress and immediately escalates the incident to the Help Desk Admin.',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Enter dispute reason (e.g. Foul rule violation)...',
                hintStyle: const TextStyle(color: Colors.white38),
                filled: true,
                fillColor: const Color(0xFF031C15),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              maxLines: 3,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () async {
              final reason = reasonController.text.trim();
              if (reason.isEmpty) return;
              Navigator.pop(ctx);
              final success = await _api.raiseDispute(widget.fixture.fixtureId, reason);
              if (success && mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('⚠️ Dispute raised. Help Desk Admin notified!')),
                );
                Navigator.pop(context);
              }
            },
            child: const Text('Submit Dispute'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        backgroundColor: const Color(0xFF062B20),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Board #${widget.fixture.boardNumber ?? 'TBA'} - Round ${widget.fixture.roundNumber}',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.amber),
            ),
            Text(
              '${widget.fixture.player1Name} vs ${widget.fixture.player2Name}',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.warning_amber_rounded, color: Colors.redAccent),
            tooltip: 'Raise Dispute',
            onPressed: _openDisputeDialog,
          ),
        ],
      ),
      body: Stack(
        children: [
          _isLoading
              ? const Center(child: CircularProgressIndicator(color: Colors.amber))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      // Set Selector Tab Bar
                      Row(
                        children: [1, 2, 3].map((setNum) {
                          final isSelected = _activeSet == setNum;
                          return Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 4),
                              child: ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: isSelected ? Colors.amber : const Color(0xFF0D4A37),
                                  foregroundColor: isSelected ? Colors.black : Colors.white70,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                ),
                                onPressed: () {
                                  setState(() => _activeSet = setNum);
                                  _loadScoreboard();
                                },
                                child: Text('Set $setNum', style: const TextStyle(fontWeight: FontWeight.bold)),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 16),

                      // Match Controllers Bar: 15s ICF Shot Clock + Coins Tracker
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF062B20),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF0D4A37)),
                        ),
                        child: Row(
                          children: [
                            // 15s Shot Clock Dial
                            Column(
                              children: [
                                Stack(
                                  alignment: Alignment.center,
                                  children: [
                                    SizedBox(
                                      width: 64,
                                      height: 64,
                                      child: CircularProgressIndicator(
                                        value: _shotClockSeconds / 15.0,
                                        strokeWidth: 6,
                                        backgroundColor: const Color(0xFF0D4A37),
                                        color: _shotClockSeconds <= 3 ? Colors.redAccent : Colors.amber,
                                      ),
                                    ),
                                    Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          '$_shotClockSeconds',
                                          style: TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.bold,
                                            color: _shotClockSeconds <= 3 ? Colors.redAccent : Colors.white,
                                          ),
                                        ),
                                        const Text('SEC', style: TextStyle(fontSize: 8, color: Colors.white54)),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    InkWell(
                                      onTap: _toggleShotClock,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: _shotClockRunning ? Colors.amber : const Color(0xFF059669),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          _shotClockRunning ? 'Pause' : 'Start',
                                          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    InkWell(
                                      onTap: _resetShotClock,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF334155),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Icon(Icons.refresh, size: 14, color: Colors.white70),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const SizedBox(width: 16),

                            // Coins Tracker Status
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Text(
                                        'COINS TRACKER',
                                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white54),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: _queenState == 'captured'
                                              ? const Color(0xFF059669).withOpacity(0.2)
                                              : Colors.redAccent.withOpacity(0.2),
                                          borderRadius: BorderRadius.circular(4),
                                          border: Border.all(
                                            color: _queenState == 'captured' ? const Color(0xFF059669) : Colors.redAccent,
                                          ),
                                        ),
                                        child: Text(
                                          _queenState == 'captured' ? 'Queen: Pocketed' : 'Queen: In Play',
                                          style: TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.bold,
                                            color: _queenState == 'captured' ? const Color(0xFF34D399) : Colors.redAccent,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Container(
                                          padding: const EdgeInsets.all(6),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF031C15),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Column(
                                            children: [
                                              const Text('White (P1)', style: TextStyle(fontSize: 9, color: Colors.white60)),
                                              Text('$_whiteCoins left', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
                                            ],
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Container(
                                          padding: const EdgeInsets.all(6),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF031C15),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Column(
                                            children: [
                                              const Text('Black (P2)', style: TextStyle(fontSize: 9, color: Colors.white60)),
                                              Text('$_blackCoins left', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text('Dues / Fouls logged: $_fouls', style: const TextStyle(fontSize: 10, color: Colors.amber)),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Player 1 Card & Point Controls
                      _buildPlayerCard(
                        playerSlot: 'player_1',
                        playerName: widget.fixture.player1Name,
                        phone: widget.fixture.p1Phone ?? '',
                        score: _p1Score,
                        isWhite: true,
                      ),
                      const SizedBox(height: 16),

                      // Player 2 Card & Point Controls
                      _buildPlayerCard(
                        playerSlot: 'player_2',
                        playerName: widget.fixture.player2Name,
                        phone: widget.fixture.p2Phone ?? '',
                        score: _p2Score,
                        isWhite: false,
                      ),
                      const SizedBox(height: 16),

                      // Set Locking Banner
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF062B20),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFF0D4A37)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.shield_outlined, color: Color(0xFF10B981), size: 20),
                            const SizedBox(width: 8),
                            const Expanded(
                              child: Text(
                                'Locking finalizes this set score.',
                                style: TextStyle(fontSize: 11, color: Colors.white70),
                              ),
                            ),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: _isSetLocked ? const Color(0xFF334155) : const Color(0xFF059669),
                              ),
                              onPressed: _isSetLocked ? null : _lockSet,
                              icon: Icon(_isSetLocked ? Icons.check : Icons.lock, size: 14),
                              label: Text(_isSetLocked ? 'Locked' : 'Lock Set $_activeSet', style: const TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Crowd Cheers Bar
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF062B20),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: ['👏', '🎯', '🔥', '👑', '💪'].map((emoji) {
                            return InkWell(
                              onTap: () => _sendReaction(emoji),
                              child: Padding(
                                padding: const EdgeInsets.all(8),
                                child: Text(emoji, style: const TextStyle(fontSize: 26)),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),

          // Floating Reactions Overlay
          ..._reactions.map((r) => _FloatingReactionWidget(reaction: r)),
        ],
      ),
    );
  }

  Widget _buildPlayerCard({
    required String playerSlot,
    required String playerName,
    required String phone,
    required int score,
    required bool isWhite,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF062B20),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF0D4A37)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: isWhite ? Colors.white : Colors.black,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white38),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    playerName,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ],
              ),
              Text(phone, style: const TextStyle(fontSize: 11, color: Colors.white38)),
            ],
          ),
          const SizedBox(height: 12),

          // Point Number
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFF031C15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              children: [
                Text(
                  '$score',
                  style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: Colors.amber),
                ),
                const Text('POINTS', style: TextStyle(fontSize: 9, color: Colors.white38)),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Scoring Action Buttons
          Row(
            children: [
              Expanded(
                child: _buildScoreBtn(
                  label: 'White (+1)',
                  color: const Color(0xFFE2E8F0),
                  textColor: Colors.black,
                  onTap: () => _submitScore(playerSlot, 1, 'White Coin'),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _buildScoreBtn(
                  label: 'Black (+1)',
                  color: const Color(0xFF0D4A37),
                  textColor: Colors.white,
                  onTap: () => _submitScore(playerSlot, 1, 'Black Coin'),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _buildScoreBtn(
                  label: 'Queen (+3)',
                  color: const Color(0xFFE11D48),
                  textColor: Colors.white,
                  onTap: () => _submitScore(playerSlot, 3, 'Queen + Cover'),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _buildScoreBtn(
                  label: 'Due (-1)',
                  color: const Color(0xFFD97706),
                  textColor: Colors.white,
                  onTap: () => _submitScore(playerSlot, -1, 'Due / Foul Penalty'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildScoreBtn({
    required String label,
    required Color color,
    required Color textColor,
    required VoidCallback onTap,
  }) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: color,
        foregroundColor: textColor,
        disabledBackgroundColor: color.withOpacity(0.3),
        padding: const EdgeInsets.symmetric(vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      onPressed: _isSetLocked ? null : onTap,
      child: Text(
        label,
        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: textColor),
        textAlign: TextAlign.center,
      ),
    );
  }
}

class _FloatingReaction {
  final String id;
  final String emoji;
  final double startX;

  _FloatingReaction({required this.id, required this.emoji, required this.startX});
}

class _FloatingReactionWidget extends StatefulWidget {
  final _FloatingReaction reaction;

  const _FloatingReactionWidget({Key? key, required this.reaction}) : super(key: key);

  @override
  State<_FloatingReactionWidget> createState() => _FloatingReactionWidgetState();
}

class _FloatingReactionWidgetState extends State<_FloatingReactionWidget> with SingleTickerProviderStateMixin {
  late AnimationController _anim;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 2000))..forward();
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _anim,
      builder: (context, child) {
        final screenHeight = MediaQuery.of(context).size.height;
        final screenWidth = MediaQuery.of(context).size.width;
        final dy = (1.0 - _anim.value) * (screenHeight * 0.7);
        final opacity = (1.0 - _anim.value).clamp(0.0, 1.0);

        return Positioned(
          bottom: dy,
          left: screenWidth * widget.reaction.startX,
          child: Opacity(
            opacity: opacity,
            child: Text(widget.reaction.emoji, style: const TextStyle(fontSize: 36)),
          ),
        );
      },
    );
  }
}
