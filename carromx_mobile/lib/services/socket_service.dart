import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'api_service.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  bool _isConnected = false;

  final _eventController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get events => _eventController.stream;

  bool get isConnected => _isConnected;

  void connect() {
    try {
      final baseUrl = ApiService().baseUrl;
      final uri = Uri.parse(baseUrl);
      final wsHost = uri.host;
      final wsPort = uri.port;
      final wsUrl = 'ws://$wsHost:$wsPort';

      debugPrint('Connecting to WebSocket at $wsUrl');
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _isConnected = true;

      _subscription = _channel?.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message);
            if (data is Map<String, dynamic>) {
              _eventController.add(data);
            }
          } catch (e) {
            debugPrint('Error parsing WS message: $e');
          }
        },
        onError: (err) {
          debugPrint('WS error: $err');
          _isConnected = false;
        },
        onDone: () {
          debugPrint('WS closed');
          _isConnected = false;
        },
      );
    } catch (e) {
      debugPrint('WS connection failed: $e');
      _isConnected = false;
    }
  }

  void send(Map<String, dynamic> data) {
    if (_isConnected && _channel != null) {
      _channel?.sink.add(jsonEncode(data));
    }
  }

  void sendReaction(String fixtureId, String emoji) {
    send({
      'type': 'SPECTATOR_REACTION',
      'fixtureId': fixtureId,
      'emoji': emoji,
    });
  }

  void sendShotClock(String fixtureId, int timeLeft, bool isRunning) {
    send({
      'type': 'SHOT_CLOCK_SYNC',
      'fixtureId': fixtureId,
      'timeLeft': timeLeft,
      'isRunning': isRunning,
    });
  }

  void sendBoardCoins({
    required String fixtureId,
    required int whiteCoins,
    required int blackCoins,
    required String queenState,
    required int fouls,
  }) {
    send({
      'type': 'BOARD_COINS_SYNC',
      'fixtureId': fixtureId,
      'whiteCoins': whiteCoins,
      'blackCoins': blackCoins,
      'queenState': queenState,
      'fouls': fouls,
    });
  }

  void disconnect() {
    _subscription?.cancel();
    _channel?.sink.close();
    _isConnected = false;
  }
}
