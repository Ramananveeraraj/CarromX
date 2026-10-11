import 'dart:async';
import 'package:flutter/material.dart';
import 'models/app_models.dart';
import 'services/api_service.dart';
import 'services/socket_service.dart';
import 'screens/tournament_detail_screen.dart';
import 'screens/organizer_screen.dart';
import 'screens/help_desk_screen.dart';
import 'screens/player_schedule_screen.dart';
import 'screens/login_dialog.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService().init();
  SocketService().connect();
  runApp(const CarromXApp());
}

class CarromXApp extends StatelessWidget {
  const CarromXApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CarromX',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF031C15),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFF59E0B),
          secondary: Color(0xFF10B981),
          surface: Color(0xFF062B20),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF021A13),
          elevation: 0,
        ),
        bottomNavigationBarTheme: const BottomNavigationBarThemeData(
          backgroundColor: Color(0xFF021A13),
          selectedItemColor: Color(0xFFF59E0B),
          unselectedItemColor: Color(0xFF6EE7B7),
        ),
      ),
      home: const MainNavigationScreen(),
    );
  }
}

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({Key? key}) : super(key: key);

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  final _api = ApiService();
  final _socket = SocketService();
  int _currentIndex = 0;
  List<Tournament> _tournaments = [];
  bool _isLoading = true;
  StreamSubscription? _socketSub;

  @override
  void initState() {
    super.initState();
    _loadTournaments();
    _initSocketListener();
    _api.addListener(_onApiChange);
  }

  void _onApiChange() {
    if (mounted) setState(() {});
  }

  void _initSocketListener() {
    _socketSub = _socket.events.listen((event) {
      if (!mounted) return;
      final type = event['type'];
      if (type == 'DISPUTE_RAISED') {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: Colors.redAccent,
            content: Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: Colors.white),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('⚠️ Live Match Dispute: "${event['reason']}" in ${event['tournamentTitle']}'),
                ),
              ],
            ),
          ),
        );
      } else if (type == 'PRE_MATCH_NOTIFICATION') {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF0284C7),
            content: Row(
              children: [
                const Icon(Icons.notifications_active, color: Colors.white),
                const SizedBox(width: 8),
                Expanded(child: Text('🔔 ${event['message']}')),
              ],
            ),
          ),
        );
      }
    });
  }

  @override
  void dispose() {
    _api.removeListener(_onApiChange);
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _loadTournaments() async {
    setState(() => _isLoading = true);
    final list = await _api.getTournaments();
    setState(() {
      _tournaments = list;
      _isLoading = false;
    });
  }

  void _openServerConfigDialog() {
    final controller = TextEditingController(text: _api.baseUrl);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF062B20),
        title: const Text('Server Connection Config', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 16, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter the backend URL (e.g. your cloud URL https://your-server.onrender.com):',
              style: TextStyle(color: Color(0xFFD1FAE5), fontSize: 12),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'https://your-server.onrender.com',
                filled: true,
                fillColor: const Color(0xFF021A13),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF0D4A37))),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: Colors.white70))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B)),
            onPressed: () async {
              final newUrl = controller.text.trim();
              if (newUrl.isNotEmpty) {
                await _api.setBaseUrl(newUrl);
                _socket.disconnect();
                _socket.connect();
                Navigator.pop(ctx);
                _loadTournaments();
              }
            },
            child: const Text('Save & Reconnect', style: TextStyle(color: Color(0xFF021A13), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showRoleSwitcher() {
    showModalBottomSheet(
      backgroundColor: const Color(0xFF062B20),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      context: context,
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'SWITCH ACTIVE ROLE',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white54),
              ),
              const SizedBox(height: 12),
              _buildRoleTile('Player', 'player', Icons.person, Colors.amber),
              _buildRoleTile('Organizer', 'organizer', Icons.event, Colors.blueAccent),
              _buildRoleTile('Referee', 'referee', Icons.timer, const Color(0xFF10B981)),
              _buildRoleTile('Help Desk Admin', 'help_desk', Icons.shield, Colors.purpleAccent),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRoleTile(String label, String role, IconData icon, Color color) {
    final isSelected = _api.activeRole == role;
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(
        label,
        style: TextStyle(color: Colors.white, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal),
      ),
      trailing: isSelected ? const Icon(Icons.check_circle, color: Colors.amber) : null,
      onTap: () {
        _api.setActiveRole(role);
        Navigator.pop(context);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      _buildTournamentsHomeTab(),
      const OrganizerScreen(),
      const HelpDeskScreen(),
      const PlayerScheduleScreen(),
    ];

    final roleColor = _getRoleColor(_api.activeRole);

    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFFF59E0B), Color(0xFFD97706)]),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text('CX', style: TextStyle(fontWeight: FontWeight.w900, color: Color(0xFF021A13), fontSize: 13)),
            ),
            const SizedBox(width: 8),
            const Text('CarromX', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17, color: Color(0xFFFBBF24))),
          ],
        ),
        actions: [
          // Server IP config button
          IconButton(
            icon: const Icon(Icons.wifi, size: 20, color: Color(0xFF6EE7B7)),
            tooltip: 'Server Connection',
            onPressed: _openServerConfigDialog,
          ),

          // Role Switcher Badge
          InkWell(
            onTap: _showRoleSwitcher,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              margin: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                color: roleColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: roleColor.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  Icon(Icons.shield_outlined, size: 12, color: roleColor),
                  const SizedBox(width: 4),
                  Text(
                    _api.activeRole.toUpperCase().replaceAll('_', ' '),
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: roleColor),
                  ),
                ],
              ),
            ),
          ),

          // Login Avatar
          IconButton(
            icon: Icon(
              _api.currentUser != null ? Icons.account_circle : Icons.login,
              color: _api.currentUser != null ? const Color(0xFFF59E0B) : const Color(0xFF6EE7B7),
            ),
            onPressed: () => showDialog(context: context, builder: (ctx) => const LoginDialog()),
          ),
        ],
      ),
      body: screens[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: const Color(0xFF021A13),
        currentIndex: _currentIndex,
        onTap: (idx) => setState(() => _currentIndex = idx),
        selectedItemColor: const Color(0xFFF59E0B),
        unselectedItemColor: const Color(0xFF6EE7B7),
        type: BottomNavigationBarType.fixed,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Live & Events'),
          BottomNavigationBarItem(icon: Icon(Icons.dashboard_customize), label: 'Organizer'),
          BottomNavigationBarItem(icon: Icon(Icons.admin_panel_settings), label: 'Help Desk'),
          BottomNavigationBarItem(icon: Icon(Icons.calendar_month), label: 'My Matches'),
        ],
      ),
    );
  }

  Color _getRoleColor(String role) {
    switch (role) {
      case 'organizer':
        return Colors.blueAccent;
      case 'referee':
        return const Color(0xFF10B981);
      case 'help_desk':
        return Colors.purpleAccent;
      default:
        return Colors.amber;
    }
  }

  Widget _buildTournamentsHomeTab() {
    return _isLoading
        ? const Center(child: CircularProgressIndicator(color: Colors.amber))
        : RefreshIndicator(
            onRefresh: _loadTournaments,
            child: ListView(
              padding: const EdgeInsets.all(14),
              children: [
                // Live Banner
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF047857), Color(0xFF064E3B)],
                    ),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.sports_esports, size: 40, color: Color(0xFFFBBF24)),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'CarromX Live Platform',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Connected: ${_api.currentUser?.fullName ?? "Guest"} (${_api.activeRole})',
                              style: const TextStyle(fontSize: 11, color: Color(0xFFA7F3D0)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                const Text(
                  'ACTIVE TOURNAMENTS',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF6EE7B7)),
                ),
                const SizedBox(height: 8),

                if (_tournaments.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: const Color(0xFF062B20),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFF0D4A37)),
                    ),
                    child: const Center(
                      child: Text('No tournaments found.', style: TextStyle(color: Color(0xFFA7F3D0))),
                    ),
                  )
                else
                  ..._tournaments.map((t) {
                    return Card(
                      color: const Color(0xFF062B20),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: const BorderSide(color: Color(0xFF0D4A37)),
                      ),
                      margin: const EdgeInsets.only(bottom: 12),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (ctx) => TournamentDetailScreen(tournamentId: t.tournamentId),
                          ),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: t.status == 'ongoing'
                                              ? Colors.amber.withOpacity(0.2)
                                              : Colors.white12,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(
                                          t.status.toUpperCase(),
                                          style: TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.bold,
                                            color: t.status == 'ongoing' ? Colors.amber : Colors.white60,
                                          ),
                                        ),
                                      ),
                                      if (t.verifiedByHelpdesk) ...[
                                        const SizedBox(width: 6),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF059669).withOpacity(0.2),
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: const Text(
                                            '✓ VERIFIED',
                                            style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Color(0xFF34D399)),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  Text(
                                    '₹${t.entryFee.toStringAsFixed(0)}',
                                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.amber),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                t.title,
                                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                t.venueAddress,
                                style: const TextStyle(fontSize: 11, color: Colors.white60),
                              ),
                              const SizedBox(height: 10),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    '${t.format.toUpperCase()} • ${t.totalBoards} Boards • Best of ${t.totalSets}',
                                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                                  ),
                                  const Icon(Icons.arrow_forward_ios, size: 12, color: Colors.amber),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
          );
  }
}
