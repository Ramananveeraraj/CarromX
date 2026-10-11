import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/api_service.dart';
import 'score_sheet_screen.dart';

class PlayerScheduleScreen extends StatefulWidget {
  const PlayerScheduleScreen({Key? key}) : super(key: key);

  @override
  State<PlayerScheduleScreen> createState() => _PlayerScheduleScreenState();
}

class _PlayerScheduleScreenState extends State<PlayerScheduleScreen> {
  final _api = ApiService();
  List<Fixture> _myFixtures = [];
  List<dynamic> _myNotifications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final tours = await _api.getTournaments();
    final notifs = await _api.getMyNotifications();

    List<Fixture> personalMatches = [];
    final currentUserId = _api.currentUser?.userId;

    for (final t in tours) {
      final fixtures = await _api.getFixtures(t.tournamentId);
      personalMatches.addAll(fixtures.where((f) {
        if (currentUserId == null) return false;
        return f.player1Name.toLowerCase().contains('rahul') ||
            f.player2Name.toLowerCase().contains('rahul') ||
            f.player1Id == currentUserId ||
            f.player2Id == currentUserId;
      }));
    }

    setState(() {
      _myFixtures = personalMatches;
      _myNotifications = notifs;
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        backgroundColor: const Color(0xFF062B20),
        title: const Text('My Schedule & Alerts', style: TextStyle(fontSize: 16)),
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
                  // Scheduled Matches Section
                  const Row(
                    children: [
                      Icon(Icons.calendar_today, color: Colors.amber, size: 18),
                      SizedBox(width: 8),
                      Text(
                        'MY SCHEDULED MATCHES',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_myFixtures.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF062B20),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF0D4A37)),
                      ),
                      child: const Center(
                        child: Text(
                          'No scheduled matches for your profile at this time.',
                          style: TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                      ),
                    )
                  else
                    ..._myFixtures.map((f) {
                      return Card(
                        color: const Color(0xFF062B20),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: const BorderSide(color: Color(0xFF0D4A37)),
                        ),
                        margin: const EdgeInsets.only(bottom: 10),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(builder: (ctx) => ScoreSheetScreen(fixture: f)),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: Colors.amber.withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Column(
                                    children: [
                                      const Icon(Icons.sports_esports, color: Colors.amber, size: 20),
                                      const SizedBox(height: 4),
                                      Text(
                                        'B#${f.boardNumber ?? "?"}',
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Colors.amber),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${f.player1Name} vs ${f.player2Name}',
                                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        'Round ${f.roundNumber} • Status: ${f.matchStatus.toUpperCase()}',
                                        style: const TextStyle(fontSize: 11, color: Colors.white60),
                                      ),
                                      Text(
                                        f.scheduledStartTime,
                                        style: const TextStyle(fontSize: 10, color: Colors.white38),
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(Icons.chevron_right, color: Colors.white38),
                              ],
                            ),
                          ),
                        ),
                      );
                    }),

                  const SizedBox(height: 20),

                  // 10-Minute Pre-Match Push Notifications Section
                  const Row(
                    children: [
                      Icon(Icons.notifications_active, color: Color(0xFF38BDF8), size: 18),
                      SizedBox(width: 8),
                      Text(
                        '10-MIN PRE-MATCH PUSH ALERTS',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_myNotifications.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF062B20),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF0D4A37)),
                      ),
                      child: const Center(
                        child: Text(
                          'No pre-match alerts yet. Background worker scans every 60s.',
                          style: TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                      ),
                    )
                  else
                    ..._myNotifications.map((n) {
                      return Card(
                        color: const Color(0xFF062B20),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                          side: BorderSide(color: Colors.amber.withOpacity(0.3)),
                        ),
                        margin: const EdgeInsets.only(bottom: 8),
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'Board #${n['board_number'] ?? "TBA"} Alert',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber),
                                  ),
                                  Text(
                                    n['dispatched_at'] ?? '',
                                    style: const TextStyle(fontSize: 9, color: Colors.white38),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                n['message'] ?? '',
                                style: const TextStyle(fontSize: 12, color: Colors.white70),
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
