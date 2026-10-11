import 'package:flutter/material.dart';
import '../services/api_service.dart';

class LoginDialog extends StatefulWidget {
  const LoginDialog({Key? key}) : super(key: key);

  @override
  State<LoginDialog> createState() => _LoginDialogState();
}

class _LoginDialogState extends State<LoginDialog> {
  final _api = ApiService();
  final _phoneController = TextEditingController(text: '+919876543210');
  final _nameController = TextEditingController(text: 'Rahul Verma');
  final _otpController = TextEditingController();

  bool _otpSent = false;
  String _devOtp = '123456';
  bool _isLoading = false;

  Future<void> _sendOtp() async {
    final phone = _phoneController.text.trim();
    if (phone.isEmpty) return;

    setState(() => _isLoading = true);
    try {
      final res = await _api.sendOtp(phone, _nameController.text.trim());
      setState(() {
        _otpSent = true;
        _devOtp = res['devOtp'] ?? '123456';
        _otpController.text = _devOtp;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _verifyOtp() async {
    setState(() => _isLoading = true);
    final ok = await _api.verifyOtp(
      _phoneController.text.trim(),
      _otpController.text.trim(),
      fullName: _nameController.text.trim(),
    );
    setState(() => _isLoading = false);

    if (ok && mounted) {
      Navigator.pop(context, true);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid OTP or Verification Failed')),
      );
    }
  }

  Future<void> _personaLogin(String role) async {
    setState(() => _isLoading = true);
    final ok = await _api.quickPersonaLogin(role);
    setState(() => _isLoading = false);
    if (ok && mounted) {
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: const Color(0xFF062B20),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFF0D4A37)),
      ),
      title: const Row(
        children: [
          Icon(Icons.sports_esports, color: Color(0xFFF59E0B)),
          SizedBox(width: 8),
          Text('CarromX Login & Roles', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 16, fontWeight: FontWeight.bold)),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '1-TAP PERSONA QUICK LOGIN:',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF6EE7B7)),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _buildPersonaChip('Admin (carrromx)', 'super_admin', const Color(0xFFF59E0B)),
                _buildPersonaChip('Organizer', 'organizer', Colors.blueAccent),
                _buildPersonaChip('Referee', 'referee', const Color(0xFF10B981)),
                _buildPersonaChip('Player', 'player', const Color(0xFF6EE7B7)),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: Color(0xFF0D4A37)),
            const SizedBox(height: 8),
            const Text(
              'OR ENTER PHONE NUMBER:',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF6EE7B7)),
            ),
            const SizedBox(height: 8),
            if (!_otpSent) ...[
              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                  filled: true,
                  fillColor: const Color(0xFF021A13),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF0D4A37))),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Full Name',
                  labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                  filled: true,
                  fillColor: const Color(0xFF021A13),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF0D4A37))),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B)),
                  onPressed: _isLoading ? null : _sendOtp,
                  child: Text(_isLoading ? 'Sending...' : 'Send SMS OTP', style: const TextStyle(color: Color(0xFF021A13), fontWeight: FontWeight.bold)),
                ),
              ),
            ] else ...[
              Text(
                'Development OTP Code: $_devOtp',
                style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: '6-digit OTP',
                  labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                  filled: true,
                  fillColor: const Color(0xFF021A13),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF0D4A37))),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                  onPressed: _isLoading ? null : _verifyOtp,
                  child: Text(_isLoading ? 'Verifying...' : 'Verify OTP & Login', style: const TextStyle(color: Colors.white)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildPersonaChip(String label, String role, Color color) {
    return ActionChip(
      backgroundColor: color.withOpacity(0.15),
      side: BorderSide(color: color.withOpacity(0.5)),
      label: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)),
      onPressed: _isLoading ? null : () => _personaLogin(role),
    );
  }
}
