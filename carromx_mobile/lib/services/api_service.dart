import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';

class ApiService extends ChangeNotifier {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  // Default server url set to the host PC Wi-Fi IP for direct mobile device access:
  String _baseUrl = 'http://192.168.31.244:3000';
  String? _token;
  User? _currentUser;
  String _activeRole = 'player';

  String get baseUrl => _baseUrl;
  String? get token => _token;
  User? get currentUser => _currentUser;
  String get activeRole => _activeRole;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString('server_url') ?? _baseUrl;
    _token = prefs.getString('auth_token');
    _activeRole = prefs.getString('active_role') ?? 'player';
    final userJson = prefs.getString('user_profile');
    if (userJson != null) {
      try {
        _currentUser = User.fromJson(jsonDecode(userJson));
      } catch (_) {}
    }
    notifyListeners();
  }

  Future<void> setBaseUrl(String url) async {
    _baseUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', _baseUrl);
    notifyListeners();
  }

  Future<void> setActiveRole(String role) async {
    _activeRole = role;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('active_role', _activeRole);
    notifyListeners();
  }

  Map<String, String> get _headers {
    final map = {
      'Content-Type': 'application/json',
      'x-carromx-active-role': _activeRole,
    };
    if (_token != null) {
      map['Authorization'] = 'Bearer $_token';
    }
    return map;
  }

  // --- Auth & Persona Logins ---

  Future<bool> quickPersonaLogin(String role) async {
    final phoneMap = {
      'super_admin': '+919876543210',
      'player': '+919876543210',
      'organizer': '+919876543210',
      'referee': '+919876543210',
      'help_desk': '+919876543210',
    };
    final phone = phoneMap[role] ?? '+919876543210';
    return await verifyOtp(phone, 'Ramanan@03', desiredRole: role);
  }

  Future<bool> loginWithCredentials(String email, String password) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': password}),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _token = data['token'];
        _currentUser = User.fromJson(data['user']);
        _activeRole = _currentUser?.role ?? 'super_admin';

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) await prefs.setString('auth_token', _token!);
        await prefs.setString('active_role', _activeRole);
        await prefs.setString('user_profile', jsonEncode(data['user']));

        notifyListeners();
        return true;
      }
    } catch (e) {
      debugPrint('loginWithCredentials error: $e');
    }
    return false;
  }

  Future<Map<String, dynamic>> sendOtp(String phone, String name, {String? email}) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/auth/send-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'phoneNumber': phone,
        'email': email,
        'fullName': name
      }),
    );
    return jsonDecode(res.body);
  }

  Future<bool> verifyOtp(String phone, String otp, {String? fullName, String? email, String? desiredRole}) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/api/auth/verify-otp'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phoneNumber': phone,
          'email': email,
          'otp': otp,
          'fullName': fullName ?? 'Carrom User',
          'desiredRole': desiredRole ?? _activeRole,
        }),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _token = data['token'];
        _currentUser = User.fromJson(data['user']);
        if (desiredRole != null) _activeRole = desiredRole;

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) await prefs.setString('auth_token', _token!);
        await prefs.setString('active_role', _activeRole);
        await prefs.setString('user_profile', jsonEncode(data['user']));

        notifyListeners();
        return true;
      }
    } catch (e) {
      debugPrint('Verify OTP error: $e');
    }
  Future<Map<String, dynamic>> forgotPassword(String email) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/auth/forgot-password'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
    return jsonDecode(res.body);
  }

  Future<bool> resetPassword(String email, String otp, String newPassword) async {
    try {
      final res = await http.post(
        Uri.parse('$_baseUrl/api/auth/reset-password'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          'otp': otp,
          'newPassword': newPassword,
        }),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _token = data['token'];
        _currentUser = User.fromJson(data['user']);
        _activeRole = _currentUser?.role ?? 'super_admin';

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) await prefs.setString('auth_token', _token!);
        await prefs.setString('active_role', _activeRole);
        await prefs.setString('user_profile', jsonEncode(data['user']));

        notifyListeners();
        return true;
      }
    } catch (e) {
      debugPrint('Reset password error: $e');
    }
    return false;
  }

  Future<void> logout() async {
    _token = null;
    _currentUser = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('user_profile');
    notifyListeners();
  }

  // --- Tournaments ---

  Future<List<Tournament>> getTournaments() async {
    try {
      final res = await http.get(Uri.parse('$_baseUrl/api/tournaments'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = (data['tournaments'] as List?) ?? [];
        return list.map((item) => Tournament.fromJson(item)).toList();
      }
    } catch (e) {
      debugPrint('getTournaments error: $e');
    }
    return [];
  }

  Future<Map<String, dynamic>> getTournamentDetails(String id) async {
    final res = await http.get(Uri.parse('$_baseUrl/api/tournaments/$id'));
    return jsonDecode(res.body);
  }

  Future<List<StandingRow>> getStandings(String tournamentId) async {
    try {
      final res = await http.get(Uri.parse('$_baseUrl/api/tournaments/$tournamentId/standings'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = (data['standings'] as List?) ?? [];
        return list.map((item) => StandingRow.fromJson(item)).toList();
      }
    } catch (e) {
      debugPrint('getStandings error: $e');
    }
    return [];
  }

  Future<bool> createTournament(Map<String, dynamic> body) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/tournaments'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return res.statusCode == 201;
  }

  Future<bool> verifyTournament(String tournamentId, bool approve) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/tournaments/$tournamentId/verify'),
      headers: _headers,
      body: jsonEncode({'approved': approve}),
    );
    return res.statusCode == 200;
  }

  Future<bool> registerWithUpi(String tournamentId, String utr) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/tournaments/$tournamentId/register'),
      headers: _headers,
      body: jsonEncode({'paymentReferenceId': utr}),
    );
    return res.statusCode == 201;
  }

  // --- Fixtures & Digital Score Sheet ---

  Future<List<Fixture>> getFixtures(String tournamentId) async {
    try {
      final res = await http.get(Uri.parse('$_baseUrl/api/tournaments/$tournamentId/fixtures'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = (data['fixtures'] as List?) ?? [];
        return list.map((item) => Fixture.fromJson(item)).toList();
      }
    } catch (e) {
      debugPrint('getFixtures error: $e');
    }
    return [];
  }

  Future<Map<String, dynamic>> getScoreboard(String fixtureId) async {
    final res = await http.get(Uri.parse('$_baseUrl/api/fixtures/$fixtureId/scoreboard'));
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> postScoreEvent({
    required String fixtureId,
    required int setNumber,
    required String player, // 'player_1' or 'player_2'
    required int pointDelta,
    required String carromAction,
  }) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/fixtures/$fixtureId/score-event'),
      headers: _headers,
      body: jsonEncode({
        'setNumber': setNumber,
        'player': player,
        'pointDelta': pointDelta,
        'carromAction': carromAction,
      }),
    );
    return jsonDecode(res.body);
  }

  Future<bool> lockSet(String fixtureId, int setNumber) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/fixtures/$fixtureId/lock-set'),
      headers: _headers,
      body: jsonEncode({'setNumber': setNumber}),
    );
    return res.statusCode == 200;
  }

  // --- Match Disputes ---

  Future<bool> raiseDispute(String fixtureId, String reason) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/fixtures/$fixtureId/dispute'),
      headers: _headers,
      body: jsonEncode({'reason': reason}),
    );
    return res.statusCode == 200;
  }

  Future<bool> resolveDispute({
    required String fixtureId,
    required String resolutionStatus,
    required String notes,
    String? winnerParticipantId,
  }) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/fixtures/$fixtureId/resolve-dispute'),
      headers: _headers,
      body: jsonEncode({
        'resolutionStatus': resolutionStatus,
        'notes': notes,
        'winnerParticipantId': winnerParticipantId,
      }),
    );
    return res.statusCode == 200;
  }

  // --- Organizer Participants & Fixtures ---

  Future<List<Participant>> getParticipants(String tournamentId) async {
    try {
      final res = await http.get(Uri.parse('$_baseUrl/api/tournaments/$tournamentId/participants'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = (data['participants'] as List?) ?? [];
        return list.map((item) => Participant.fromJson(item)).toList();
      }
    } catch (e) {
      debugPrint('getParticipants error: $e');
    }
    return [];
  }

  Future<bool> reviewPayment(String participantId, String status) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/participants/$participantId/review-payment'),
      headers: _headers,
      body: jsonEncode({'status': status}),
    );
    return res.statusCode == 200;
  }

  Future<bool> generateFixtures(String tournamentId, String format) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/api/tournaments/$tournamentId/generate-fixtures'),
      headers: _headers,
      body: jsonEncode({'format': format}),
    );
    return res.statusCode == 200;
  }

  // --- Notifications ---

  Future<List<dynamic>> getMyNotifications() async {
    try {
      final res = await http.get(
        Uri.parse('$_baseUrl/api/notifications/my'),
        headers: _headers,
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return (data['notifications'] as List?) ?? [];
      }
    } catch (_) {}
    return [];
  }
}
