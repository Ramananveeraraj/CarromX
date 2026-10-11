import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/api_service.dart';

class OrganizerScreen extends StatefulWidget {
  const OrganizerScreen({Key? key}) : super(key: key);

  @override
  State<OrganizerScreen> createState() => _OrganizerScreenState();
}

class _OrganizerScreenState extends State<OrganizerScreen> {
  final _api = ApiService();
  List<Tournament> _myTournaments = [];
  String? _selectedTourId;
  List<Participant> _participants = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final tours = await _api.getTournaments();
    setState(() {
      _myTournaments = tours;
      if (_selectedTourId == null && tours.isNotEmpty) {
        _selectedTourId = tours.first.tournamentId;
      }
    });

    if (_selectedTourId != null) {
      await _loadParticipants(_selectedTourId!);
    } else {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadParticipants(String tourId) async {
    final list = await _api.getParticipants(tourId);
    setState(() {
      _participants = list;
      _isLoading = false;
    });
  }

  Future<void> _reviewPayment(String participantId, String status) async {
    final ok = await _api.reviewPayment(participantId, status);
    if (ok && _selectedTourId != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Payment status updated to $status!')),
      );
      _loadParticipants(_selectedTourId!);
    }
  }

  Future<void> _generateFixtures() async {
    if (_selectedTourId == null) return;
    final ok = await _api.generateFixtures(_selectedTourId!, 'knockout');
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ok ? 'Fixtures successfully generated!' : 'Failed to generate fixtures.')),
      );
    }
  }

  void _openCreateTournamentDialog() {
    final titleController = TextEditingController();
    final venueController = TextEditingController();
    final boardsController = TextEditingController(text: '4');
    final maxPtsController = TextEditingController(text: '25');
    final setsController = TextEditingController(text: '3');
    final feeController = TextEditingController(text: '500');
    final upiController = TextEditingController(text: 'carromx@upi');
    String format = 'knockout';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF062B20),
          title: const Text('Create Tournament', style: TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildField(titleController, 'Tournament Title (e.g. City Open)'),
                const SizedBox(height: 8),
                _buildField(venueController, 'Venue Address'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _buildField(boardsController, 'Total Boards', isNum: true)),
                    const SizedBox(width: 8),
                    Expanded(child: _buildField(maxPtsController, 'Points Limit', isNum: true)),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _buildField(setsController, 'Best of Sets', isNum: true)),
                    const SizedBox(width: 8),
                    Expanded(child: _buildField(feeController, 'Entry Fee (₹)', isNum: true)),
                  ],
                ),
                const SizedBox(height: 8),
                _buildField(upiController, 'Organizer UPI ID'),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: format,
                  dropdownColor: const Color(0xFF062B20),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'Tournament Format',
                    labelStyle: const TextStyle(color: Colors.white60),
                    filled: true,
                    fillColor: const Color(0xFF031C15),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'knockout', child: Text('Knockout Bracket')),
                    DropdownMenuItem(value: 'round_robin', child: Text('Round Robin League')),
                    DropdownMenuItem(value: 'double_elimination', child: Text('Double Elimination')),
                  ],
                  onChanged: (v) => setDialogState(() => format = v ?? 'knockout'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.amber),
              onPressed: () async {
                final title = titleController.text.trim();
                final venue = venueController.text.trim();
                if (title.isEmpty || venue.isEmpty) return;

                Navigator.pop(ctx);
                final ok = await _api.createTournament({
                  'title': title,
                  'venue_address': venue,
                  'format': format,
                  'total_boards': int.tryParse(boardsController.text) ?? 4,
                  'max_points_per_set': int.tryParse(maxPtsController.text) ?? 25,
                  'boards_per_set': 8,
                  'total_sets': int.tryParse(setsController.text) ?? 3,
                  'entry_fee': double.tryParse(feeController.text) ?? 500,
                  'upi_id': upiController.text.trim(),
                });

                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(ok
                          ? 'Tournament created! Pending Help Desk verification.'
                          : 'Failed to create tournament.'),
                    ),
                  );
                  _loadData();
                }
              },
              child: const Text('Create', style: TextStyle(color: Colors.black)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildField(TextEditingController controller, String label, {bool isNum = false}) {
    return TextField(
      controller: controller,
      keyboardType: isNum ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white60, fontSize: 11),
        filled: true,
        fillColor: const Color(0xFF031C15),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF031C15),
      appBar: AppBar(
        backgroundColor: const Color(0xFF062B20),
        title: const Text('Organizer Suite', style: TextStyle(fontSize: 16)),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_circle, color: Colors.amber),
            tooltip: 'Create Tournament',
            onPressed: _openCreateTournamentDialog,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.amber))
          : Column(
              children: [
                // Tournament Selector Dropdown
                Container(
                  padding: const EdgeInsets.all(12),
                  color: const Color(0xFF062B20),
                  child: Row(
                    children: [
                      const Icon(Icons.emoji_events, color: Colors.amber, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: DropdownButton<String>(
                          value: _selectedTourId,
                          isExpanded: true,
                          dropdownColor: const Color(0xFF062B20),
                          underline: const SizedBox(),
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                          items: _myTournaments.map((t) {
                            return DropdownMenuItem(
                              value: t.tournamentId,
                              child: Text(t.title, overflow: TextOverflow.ellipsis),
                            );
                          }).toList(),
                          onChanged: (id) {
                            if (id != null) {
                              setState(() => _selectedTourId = id);
                              _loadParticipants(id);
                            }
                          },
                        ),
                      ),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF059669),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        ),
                        onPressed: _generateFixtures,
                        child: const Text('Gen Fixtures', style: TextStyle(fontSize: 11)),
                      ),
                    ],
                  ),
                ),

                // Participants Payments Review List
                Expanded(
                  child: _participants.isEmpty
                      ? const Center(
                          child: Text('No participants registered yet.', style: TextStyle(color: Colors.white54)),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: _participants.length,
                          itemBuilder: (context, idx) {
                            final p = _participants[idx];
                            final isApproved = p.paymentStatus == 'approved';
                            return Card(
                              color: const Color(0xFF062B20),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                                side: BorderSide(
                                  color: isApproved ? const Color(0xFF059669) : Colors.amber.withOpacity(0.5),
                                ),
                              ),
                              margin: const EdgeInsets.only(bottom: 8),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Row(
                                  children: [
                                    CircleAvatar(
                                      radius: 16,
                                      backgroundColor: const Color(0xFF0D4A37),
                                      child: const Icon(Icons.person, color: Colors.white70, size: 18),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            p.fullName,
                                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                                          ),
                                          Text(
                                            'UTR: ${p.paymentReferenceId ?? "N/A"}',
                                            style: const TextStyle(fontSize: 11, color: Colors.amber),
                                          ),
                                          Text(p.phoneNumber, style: const TextStyle(fontSize: 10, color: Colors.white38)),
                                        ],
                                      ),
                                    ),
                                    if (!isApproved) ...[
                                      IconButton(
                                        icon: const Icon(Icons.check_circle, color: Color(0xFF34D399)),
                                        tooltip: 'Approve Payment',
                                        onPressed: () => _reviewPayment(p.participantId, 'approved'),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.cancel, color: Colors.redAccent),
                                        tooltip: 'Reject Payment',
                                        onPressed: () => _reviewPayment(p.participantId, 'rejected'),
                                      ),
                                    ] else ...[
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF059669).withOpacity(0.2),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Text(
                                          'APPROVED',
                                          style: TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF34D399),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
