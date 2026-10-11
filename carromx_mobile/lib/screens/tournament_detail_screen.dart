import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/api_service.dart';
import 'score_sheet_screen.dart';

class TournamentDetailScreen extends StatefulWidget {
  final String tournamentId;

  const TournamentDetailScreen({Key? key, required this.tournamentId}) : super(key: key);

  @override
  State<TournamentDetailScreen> createState() => _TournamentDetailScreenState();
}

class _TournamentDetailScreenState extends State<TournamentDetailScreen> with SingleTickerProviderStateMixin {
  final _api = ApiService();
  Tournament? _tournament;
  List<Fixture> _fixtures = [];
  List<StandingRow> _standings = [];
  bool _isLoading = true;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      final tData = await _api.getTournamentDetails(widget.tournamentId);
      final t = Tournament.fromJson(tData['tournament']);
      final fList = ((tData['fixtures'] as List?) ?? []).map((i) => Fixture.fromJson(i)).toList();
      final standings = await _api.getStandings(widget.tournamentId);

      setState(() {
        _tournament = t;
        _fixtures = fList;
        _standings = standings;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  void _openRegisterDialog() {
    final utrController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF062B20),
        title: const Text('UPI Registration (Method 1)', style: TextStyle(color: Colors.white, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Entry Fee: ₹${_tournament?.entryFee.toStringAsFixed(0) ?? "500"}',
              style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 6),
            Text(
              'Pay via UPI to: ${_tournament?.upiId ?? "carromx@upi"}',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 12),
            const Text(
              'Enter 12-digit UPI / UTR Transaction Reference ID:',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: utrController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'e.g. 202610081234',
                hintStyle: const TextStyle(color: Colors.white38),
                filled: true,
                fillColor: const Color(0xFF031C15),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.amber),
            onPressed: () async {
              final utr = utrController.text.trim();
              if (utr.isEmpty) return;
              Navigator.pop(ctx);
              final ok = await _api.registerWithUpi(widget.tournamentId, utr);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(ok
                        ? 'Registration submitted! Awaiting Organizer approval.'
                        : 'Registration failed.'),
                  ),
                );
              }
            },
            child: const Text('Submit UTR', style: TextStyle(color: Colors.black)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        backgroundColor: const Color(0xFF031C15),
        appBar: AppBar(backgroundColor: const Color(0xFF062B20), title: const Text('Tournament Details')),
        body: const Center(child: CircularProgressIndicator(color: Colors.amber)),
      );
    }

    final t = _tournament!;
    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        backgroundColor: const Color(0xFF062B20),
        title: Text(t.title, style: const TextStyle(fontSize: 16)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: Colors.amber,
          tabs: const [
            Tab(text: 'Fixtures & Matches'),
            Tab(text: 'Live Standings'),
          ],
        ),
      ),
      body: Column(
        children: [
          // Tournament Header Specs
          Container(
            padding: const EdgeInsets.all(14),
            margin: const EdgeInsets.all(12),
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
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: t.verifiedByHelpdesk
                            ? const Color(0xFF059669).withOpacity(0.2)
                            : Colors.amber.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        t.verifiedByHelpdesk ? '✓ Help Desk Verified' : 'Pending Verification',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: t.verifiedByHelpdesk ? const Color(0xFF34D399) : Colors.amber,
                        ),
                      ),
                    ),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.amber,
                        foregroundColor: Colors.black,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      ),
                      onPressed: _openRegisterDialog,
                      icon: const Icon(Icons.payment, size: 14),
                      label: const Text('Register', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  t.venueAddress,
                  style: const TextStyle(fontSize: 12, color: Colors.white70),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildSpecItem('Boards', '${t.totalBoards}'),
                    _buildSpecItem('Points', '${t.maxPointsPerSet} pts'),
                    _buildSpecItem('Sets', 'Best of ${t.totalSets}'),
                    _buildSpecItem('Fee', '₹${t.entryFee.toStringAsFixed(0)}'),
                  ],
                ),
              ],
            ),
          ),

          // Tab View
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                // 1. Fixtures Tab
                _fixtures.isEmpty
                    ? const Center(
                        child: Text('No fixtures generated yet.', style: TextStyle(color: Colors.white54)),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadData,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _fixtures.length,
                          itemBuilder: (context, idx) {
                            final f = _fixtures[idx];
                            final isLive = f.matchStatus == 'live';
                            return Card(
                              color: const Color(0xFF062B20),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                                side: BorderSide(color: isLive ? Colors.amber : const Color(0xFF0D4A37)),
                              ),
                              margin: const EdgeInsets.only(bottom: 10),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (ctx) => ScoreSheetScreen(fixture: f),
                                  ),
                                ).then((_) => _loadData()),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFF0D4A37),
                                              borderRadius: BorderRadius.circular(4),
                                            ),
                                            child: Text(
                                              'Board #${f.boardNumber ?? "TBA"} • R${f.roundNumber}',
                                              style: const TextStyle(fontSize: 10, color: Colors.white70),
                                            ),
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: isLive
                                                  ? Colors.amber.withOpacity(0.2)
                                                  : (f.matchStatus == 'completed'
                                                      ? const Color(0xFF059669).withOpacity(0.2)
                                                      : Colors.white12),
                                              borderRadius: BorderRadius.circular(4),
                                            ),
                                            child: Text(
                                              f.matchStatus.toUpperCase(),
                                              style: TextStyle(
                                                fontSize: 10,
                                                fontWeight: FontWeight.bold,
                                                color: isLive
                                                    ? Colors.amber
                                                    : (f.matchStatus == 'completed'
                                                        ? const Color(0xFF34D399)
                                                        : Colors.white54),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              f.player1Name,
                                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                                            ),
                                          ),
                                          const Padding(
                                            padding: EdgeInsets.symmetric(horizontal: 8),
                                            child: Text('VS', style: TextStyle(fontSize: 11, color: Colors.amber)),
                                          ),
                                          Expanded(
                                            child: Text(
                                              f.player2Name,
                                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                                              textAlign: TextAlign.end,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),

                // 2. Standings Tab
                _standings.isEmpty
                    ? const Center(
                        child: Text('No standings data available yet.', style: TextStyle(color: Colors.white54)),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _standings.length,
                        itemBuilder: (context, idx) {
                          final s = _standings[idx];
                          return Card(
                            color: const Color(0xFF062B20),
                            margin: const EdgeInsets.only(bottom: 8),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            child: Padding(
                              padding: const EdgeInsets.all(10),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 14,
                                    backgroundColor: idx == 0
                                        ? Colors.amber
                                        : (idx == 1 ? Colors.grey : const Color(0xFF0D4A37)),
                                    child: Text(
                                      '${idx + 1}',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: idx < 2 ? Colors.black : Colors.white,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          s.fullName,
                                          style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                                        ),
                                        Text(
                                          'P: ${s.played} | W: ${s.won} | L: ${s.lost} | Sets: ${s.setsWon}-${s.setsLost}',
                                          style: const TextStyle(fontSize: 11, color: Colors.white54),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        '${s.tablePoints} PTS',
                                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.amber),
                                      ),
                                      Text(
                                        'Diff: ${s.pointsDiff >= 0 ? "+" : ""}${s.pointsDiff}',
                                        style: TextStyle(
                                          fontSize: 10,
                                          color: s.pointsDiff >= 0 ? const Color(0xFF34D399) : Colors.redAccent,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSpecItem(String label, String value) {
    return Column(
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: Colors.white38)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white)),
      ],
    );
  }
}
