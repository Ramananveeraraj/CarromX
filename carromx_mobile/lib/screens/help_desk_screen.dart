import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/api_service.dart';

class HelpDeskScreen extends StatefulWidget {
  const HelpDeskScreen({Key? key}) : super(key: key);

  @override
  State<HelpDeskScreen> createState() => _HelpDeskScreenState();
}

class _HelpDeskScreenState extends State<HelpDeskScreen> {
  final _api = ApiService();
  List<Tournament> _tournaments = [];
  List<Fixture> _disputedFixtures = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final tours = await _api.getTournaments();

    // Check for disputed fixtures across tournaments
    List<Fixture> disputes = [];
    for (final t in tours) {
      final fixtures = await _api.getFixtures(t.tournamentId);
      disputes.addAll(fixtures.where((f) => f.matchStatus == 'disputed'));
    }

    setState(() {
      _tournaments = tours;
      _disputedFixtures = disputes;
      _isLoading = false;
    });
  }

  Future<void> _verifyTournament(String tourId, bool approve) async {
    final ok = await _api.verifyTournament(tourId, approve);
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(approve ? '✓ Tournament Verified & Published!' : 'Verification revoked.')),
      );
      _loadData();
    }
  }

  Future<void> _resolveDispute(Fixture fix, String status, {String? winnerId}) async {
    final notesController = TextEditingController(
      text: status == 'live'
          ? 'Board inspected; fair play confirmed. Match resumed.'
          : 'Official Help Desk ruling delivered.',
    );

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF062B20),
        title: Text('Resolve Dispute (${status.toUpperCase()})', style: const TextStyle(color: Colors.white, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${fix.player1Name} vs ${fix.player2Name} • Board #${fix.boardNumber ?? "TBA"}',
              style: const TextStyle(color: Colors.amber, fontSize: 12),
            ),
            const SizedBox(height: 10),
            const Text('Ruling Notes / Resolution Record:', style: TextStyle(color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 6),
            TextField(
              controller: notesController,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                filled: true,
                fillColor: const Color(0xFF031C15),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF059669)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Submit Ruling'),
          ),
        ],
      ),
    );

    if (ok == true) {
      final success = await _api.resolveDispute(
        fixtureId: fix.fixtureId,
        resolutionStatus: status,
        notes: notesController.text.trim(),
        winnerParticipantId: winnerId,
      );
      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Dispute resolved: Match status set to $status!')),
        );
        _loadData();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        backgroundColor: const Color(0xFF062B20),
        title: const Text('Help Desk Admin Portal', style: TextStyle(fontSize: 16)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.amber))
          : RefreshIndicator(
              onRefresh: _loadData,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  // Active Match Disputes Section
                  Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'ACTIVE MATCH DISPUTES (${_disputedFixtures.length})',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_disputedFixtures.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF062B20),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF0D4A37)),
                      ),
                      child: const Center(
                        child: Text(
                          '✓ No active disputes reported. All matches fair.',
                          style: TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                      ),
                    )
                  else
                    ..._disputedFixtures.map((f) {
                      return Card(
                        color: const Color(0xFF062B20),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: const BorderSide(color: Colors.redAccent),
                        ),
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.redAccent.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: const Text(
                                      'DISPUTED MATCH',
                                      style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.redAccent),
                                    ),
                                  ),
                                  Text(
                                    'Board #${f.boardNumber ?? "TBA"} • Round ${f.roundNumber}',
                                    style: const TextStyle(fontSize: 11, color: Colors.white70),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                '${f.player1Name} vs ${f.player2Name}',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: ElevatedButton.icon(
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(0xFF059669),
                                        padding: const EdgeInsets.symmetric(vertical: 8),
                                      ),
                                      onPressed: () => _resolveDispute(f, 'live'),
                                      icon: const Icon(Icons.play_arrow, size: 14),
                                      label: const Text('Resume Live', style: TextStyle(fontSize: 11)),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  ElevatedButton(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.amber,
                                      foregroundColor: Colors.black,
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                    ),
                                    onPressed: () => _resolveDispute(f, 'completed', winnerId: f.player1Id),
                                    child: const Text('P1 Win', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                  ),
                                  const SizedBox(width: 6),
                                  ElevatedButton(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.amber,
                                      foregroundColor: Colors.black,
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                    ),
                                    onPressed: () => _resolveDispute(f, 'completed', winnerId: f.player2Id),
                                    child: const Text('P2 Win', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    }),

                  const SizedBox(height: 24),

                  // Tournament Verification Queue
                  Row(
                    children: [
                      const Icon(Icons.shield_outlined, color: Colors.purpleAccent, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'TOURNAMENT REVIEW QUEUE (${_tournaments.length})',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ..._tournaments.map((t) {
                    final isVerified = t.verifiedByHelpdesk;
                    return Card(
                      color: const Color(0xFF062B20),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: isVerified ? const Color(0xFF059669) : Colors.amber.withOpacity(0.4),
                        ),
                      ),
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  t.title,
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: isVerified
                                        ? const Color(0xFF059669).withOpacity(0.2)
                                        : Colors.amber.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    isVerified ? 'VERIFIED' : 'PENDING',
                                    style: TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.bold,
                                      color: isVerified ? const Color(0xFF34D399) : Colors.amber,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${t.format.toUpperCase()} • ${t.totalBoards} Boards • ₹${t.entryFee.toStringAsFixed(0)}',
                              style: const TextStyle(fontSize: 11, color: Colors.white60),
                            ),
                            Text(t.venueAddress, style: const TextStyle(fontSize: 10, color: Colors.white38)),
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: isVerified ? const Color(0xFF334155) : const Color(0xFF9333EA),
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                ),
                                onPressed: () => _verifyTournament(t.tournamentId, !isVerified),
                                icon: Icon(isVerified ? Icons.undo : Icons.verified, size: 14),
                                label: Text(
                                  isVerified ? 'Revoke' : 'Verify & Publish',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
    );
  }
}
