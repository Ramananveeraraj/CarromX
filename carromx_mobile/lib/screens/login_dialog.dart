import 'package:flutter/material.dart';
import '../services/api_service.dart';

class LoginDialog extends StatefulWidget {
  const LoginDialog({Key? key}) : super(key: key);

  @override
  State<LoginDialog> createState() => _LoginDialogState();
}

class _LoginDialogState extends State<LoginDialog> {
  final _api = ApiService();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _nameController = TextEditingController();
  final _otpController = TextEditingController();

  bool _otpSent = false;
  String _devOtp = '123456';
  bool _isLoading = false;

  Future<void> _sendOtp() async {
    final phone = _phoneController.text.trim();
    final email = _emailController.text.trim();
    if (phone.isEmpty && email.isEmpty) return;

    setState(() => _isLoading = true);
    try {
      final res = await _api.sendOtp(
        phone,
        _nameController.text.trim(),
        email: email.isNotEmpty ? email : null,
      );
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
    final phone = _phoneController.text.trim();
    final email = _emailController.text.trim();
    final ok = await _api.verifyOtp(
      phone,
      _otpController.text.trim(),
      email: email.isNotEmpty ? email : null,
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

  Future<void> _showForgotPasswordDialog() async {
    final resetEmailController = TextEditingController(text: _emailController.text.trim());
    final resetOtpController = TextEditingController();
    final resetPassController = TextEditingController();
    bool codeSent = false;
    String devCode = '';

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF062B20),
          title: const Text('Password Recovery', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 16, fontWeight: FontWeight.bold)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!codeSent) ...[
                  const Text('Enter your registered email address to receive a 6-digit recovery code:', style: TextStyle(color: Color(0xFFA7F3D0), fontSize: 12)),
                  const SizedBox(height: 12),
                  TextField(
                    controller: resetEmailController,
                    keyboardType: TextInputType.emailAddress,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: 'Registered Email',
                      labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                      filled: true,
                      fillColor: const Color(0xFF021A13),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B)),
                    onPressed: () async {
                      final email = resetEmailController.text.trim();
                      if (email.isEmpty) return;
                      final res = await _api.forgotPassword(email);
                      setDialogState(() {
                        codeSent = true;
                        devCode = res['devOtp'] ?? '';
                        resetOtpController.text = devCode;
                      });
                    },
                    child: const Text('Send Reset Code', style: TextStyle(color: Color(0xFF021A13), fontWeight: FontWeight.bold)),
                  ),
                ] else ...[
                  const Text('Enter the 6-digit code sent to your email and your new password:', style: TextStyle(color: Color(0xFFA7F3D0), fontSize: 12)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: resetOtpController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: '6-digit Reset Code',
                      labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                      filled: true,
                      fillColor: const Color(0xFF021A13),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: resetPassController,
                    obscureText: true,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: 'New Password (min 6 chars)',
                      labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                      filled: true,
                      fillColor: const Color(0xFF021A13),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                    onPressed: () async {
                      final ok = await _api.resetPassword(
                        resetEmailController.text.trim(),
                        resetOtpController.text.trim(),
                        resetPassController.text.trim(),
                      );
                      if (ok && mounted) {
                        Navigator.pop(ctx);
                        Navigator.pop(context, true);
                      }
                    },
                    child: const Text('Reset & Sign In', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ),
    );
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
                _buildPersonaChip('Admin', 'super_admin', const Color(0xFFF59E0B)),
                _buildPersonaChip('Organizer', 'organizer', Colors.blueAccent),
                _buildPersonaChip('Referee', 'referee', const Color(0xFF10B981)),
                _buildPersonaChip('Player', 'player', const Color(0xFF6EE7B7)),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: Color(0xFF0D4A37)),
            const SizedBox(height: 8),
            const Text(
              'OR ENTER PHONE NUMBER & EMAIL:',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF6EE7B7)),
            ),
            const SizedBox(height: 8),
            if (!_otpSent) ...[
              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Mobile Phone Number',
                  hintText: 'e.g. 9876543210',
                  hintStyle: const TextStyle(color: Color(0xFF0D4A37)),
                  labelStyle: const TextStyle(color: Color(0xFFA7F3D0)),
                  filled: true,
                  fillColor: const Color(0xFF021A13),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF0D4A37))),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  labelText: 'Email Address (Receives OTP)',
                  hintText: 'e.g. player@gmail.com',
                  hintStyle: const TextStyle(color: Color(0xFF0D4A37)),
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
                  hintText: 'Your name',
                  hintStyle: const TextStyle(color: Color(0xFF0D4A37)),
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
                  child: Text(_isLoading ? 'Sending...' : 'Send Verification OTP', style: const TextStyle(color: Color(0xFF021A13), fontWeight: FontWeight.bold)),
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
            const SizedBox(height: 8),
            Center(
              child: TextButton(
                onPressed: _showForgotPasswordDialog,
                child: const Text('Forgot Password or Need Access Reset?', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11, decoration: TextDecoration.underline)),
              ),
            ),
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
