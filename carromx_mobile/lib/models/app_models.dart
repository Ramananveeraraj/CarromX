class User {
  final String userId;
  final String fullName;
  final String phoneNumber;
  final String? email;
  final String role;

  User({
    required this.userId,
    required this.fullName,
    required this.phoneNumber,
    this.email,
    required this.role,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      userId: json['userId'] ?? json['user_id'] ?? '',
      fullName: json['fullName'] ?? json['full_name'] ?? 'Carrom Player',
      phoneNumber: json['phoneNumber'] ?? json['phone_number'] ?? '',
      email: json['email'],
      role: json['role'] ?? 'player',
    );
  }
}

class Tournament {
  final String tournamentId;
  final String title;
  final String venueAddress;
  final String format;
  final int totalBoards;
  final int maxPointsPerSet;
  final int boardsPerSet;
  final int totalSets;
  final double entryFee;
  final String status;
  final bool verifiedByHelpdesk;
  final String? upiId;
  final String? organizerName;

  Tournament({
    required this.tournamentId,
    required this.title,
    required this.venueAddress,
    required this.format,
    required this.totalBoards,
    required this.maxPointsPerSet,
    required this.boardsPerSet,
    required this.totalSets,
    required this.entryFee,
    required this.status,
    required this.verifiedByHelpdesk,
    this.upiId,
    this.organizerName,
  });

  factory Tournament.fromJson(Map<String, dynamic> json) {
    return Tournament(
      tournamentId: json['tournament_id'] ?? '',
      title: json['title'] ?? 'Carrom Tournament',
      venueAddress: json['venue_address'] ?? 'Venue TBA',
      format: json['format'] ?? 'knockout',
      totalBoards: json['total_boards'] ?? 4,
      maxPointsPerSet: json['max_points_per_set'] ?? 25,
      boardsPerSet: json['boards_per_set'] ?? 8,
      totalSets: json['total_sets'] ?? 3,
      entryFee: double.tryParse('${json['entry_fee']}') ?? 500.0,
      status: json['status'] ?? 'pending_verification',
      verifiedByHelpdesk: json['verified_by_helpdesk'] == 1 || json['verified_by_helpdesk'] == true,
      upiId: json['upi_id'],
      organizerName: json['organizer_name'],
    );
  }
}

class Fixture {
  final String fixtureId;
  final String tournamentId;
  final int roundNumber;
  final String? boardNumber;
  final String player1Name;
  final String player2Name;
  final String? player1Id;
  final String? player2Id;
  final String? p1Phone;
  final String? p2Phone;
  final String scheduledStartTime;
  final String matchStatus;
  final String? winnerName;
  final String? refereeName;

  Fixture({
    required this.fixtureId,
    required this.tournamentId,
    required this.roundNumber,
    this.boardNumber,
    required this.player1Name,
    required this.player2Name,
    this.player1Id,
    this.player2Id,
    this.p1Phone,
    this.p2Phone,
    required this.scheduledStartTime,
    required this.matchStatus,
    this.winnerName,
    this.refereeName,
  });

  factory Fixture.fromJson(Map<String, dynamic> json) {
    return Fixture(
      fixtureId: json['fixture_id'] ?? '',
      tournamentId: json['tournament_id'] ?? '',
      roundNumber: json['round_number'] ?? 1,
      boardNumber: json['board_number'] != null ? '${json['board_number']}' : null,
      player1Name: json['player_1_name'] ?? json['p1_name'] ?? 'Player 1',
      player2Name: json['player_2_name'] ?? json['p2_name'] ?? 'Player 2',
      player1Id: json['player_1_id'],
      player2Id: json['player_2_id'],
      p1Phone: json['p1_phone'],
      p2Phone: json['p2_phone'],
      scheduledStartTime: json['scheduled_start_time'] ?? '',
      matchStatus: json['match_status'] ?? 'scheduled',
      winnerName: json['winner_name'],
      refereeName: json['referee_name'],
    );
  }
}

class ScoreSet {
  final int setNumber;
  final int p1Points;
  final int p2Points;
  final bool isCompleted;
  final bool isLocked;

  ScoreSet({
    required this.setNumber,
    required this.p1Points,
    required this.p2Points,
    required this.isCompleted,
    required this.isLocked,
  });

  factory ScoreSet.fromJson(Map<String, dynamic> json) {
    return ScoreSet(
      setNumber: json['set_number'] ?? 1,
      p1Points: json['player_1_points'] ?? 0,
      p2Points: json['player_2_points'] ?? 0,
      isCompleted: json['is_set_completed'] == 1 || json['is_set_completed'] == true,
      isLocked: json['is_locked'] == 1 || json['is_locked'] == true,
    );
  }
}

class StandingRow {
  final String fullName;
  final int? seedRank;
  final int played;
  final int won;
  final int lost;
  final int setsWon;
  final int setsLost;
  final int pointsDiff;
  final int tablePoints;

  StandingRow({
    required this.fullName,
    this.seedRank,
    required this.played,
    required this.won,
    required this.lost,
    required this.setsWon,
    required this.setsLost,
    required this.pointsDiff,
    required this.tablePoints,
  });

  factory StandingRow.fromJson(Map<String, dynamic> json) {
    return StandingRow(
      fullName: json['fullName'] ?? 'Player',
      seedRank: json['seedRank'],
      played: json['played'] ?? 0,
      won: json['won'] ?? 0,
      lost: json['lost'] ?? 0,
      setsWon: json['setsWon'] ?? 0,
      setsLost: json['setsLost'] ?? 0,
      pointsDiff: json['pointsDiff'] ?? 0,
      tablePoints: json['tablePoints'] ?? 0,
    );
  }
}

class Participant {
  final String participantId;
  final String fullName;
  final String phoneNumber;
  final String paymentStatus;
  final String? paymentReferenceId;
  final int? seedingRank;

  Participant({
    required this.participantId,
    required this.fullName,
    required this.phoneNumber,
    required this.paymentStatus,
    this.paymentReferenceId,
    this.seedingRank,
  });

  factory Participant.fromJson(Map<String, dynamic> json) {
    return Participant(
      participantId: json['participant_id'] ?? '',
      fullName: json['full_name'] ?? 'Player',
      phoneNumber: json['phone_number'] ?? '',
      paymentStatus: json['payment_status'] ?? 'pending',
      paymentReferenceId: json['payment_reference_id'],
      seedingRank: json['seeding_rank'],
    );
  }
}
