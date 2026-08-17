import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../services/api.dart';
import '../theme.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({super.key, required this.api, required this.customerId});

  final GnApi api;
  final String customerId;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  RTCPeerConnection? _pc;
  MediaStream? _local;
  final _remote = RTCVideoRenderer();
  String? _callId;
  var _phase = 'Starting call…';
  var _recording = false;
  var _failed = false;
  var _hanging = false;
  var _cancelled = false;
  DateTime? _connectedAt;
  Timer? _ticker;
  Timer? _ringTimeout;
  StreamSubscription<Map<String, dynamic>?>? _callSub;
  StreamSubscription<Map<String, dynamic>>? _iceSub;
  final _pendingRemoteIce = <RTCIceCandidate>[];
  final _pendingLocalIce = <RTCIceCandidate>[];
  var _remoteReady = false;

  @override
  void initState() {
    super.initState();
    unawaited(() async {
      await _remote.initialize();
      await _start();
    }());
  }

  @override
  void dispose() {
    _cancelled = true;
    _ticker?.cancel();
    _ringTimeout?.cancel();
    unawaited(_callSub?.cancel());
    unawaited(_iceSub?.cancel());
    unawaited(_hangup(pop: false));
    unawaited(_remote.dispose());
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final iceServers = await widget.api.fetchIceServers();
      final stream = await navigator.mediaDevices.getUserMedia({'audio': true, 'video': false});
      _local = stream;
      try {
        await Helper.setSpeakerphoneOn(true);
      } catch (_) {}
      final pc = await createPeerConnection({
        'iceServers': iceServers,
        'sdpSemantics': 'unified-plan',
      });
      _pc = pc;
      pc.onTrack = (event) {
        if (event.streams.isNotEmpty) {
          _remote.srcObject = event.streams.first;
        }
      };
      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }
      pc.onIceCandidate = (candidate) {
        final value = candidate.candidate;
        if (value == null || value.isEmpty) return;
        final callId = _callId;
        if (callId == null) {
          _pendingLocalIce.add(candidate);
          return;
        }
        unawaited(
          widget.api.addIceOffer(
            customerId: widget.customerId,
            callId: callId,
            candidate: value,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
          ),
        );
      };
      final offer = await pc.createOffer({'offerToReceiveAudio': true, 'offerToReceiveVideo': false});
      await pc.setLocalDescription(offer);
      final callId = await widget.api.startVoiceCall(customerId: widget.customerId, offerSdp: offer.sdp ?? '');
      _callId = callId;
      if (_cancelled) {
        await widget.api.hangupCall(customerId: widget.customerId, callId: callId, status: 'missed');
        await pc.close();
        await stream.dispose();
        return;
      }
      for (final ice in _pendingLocalIce) {
        final value = ice.candidate;
        if (value == null || value.isEmpty) continue;
        unawaited(
          widget.api.addIceOffer(
            customerId: widget.customerId,
            callId: callId,
            candidate: value,
            sdpMid: ice.sdpMid,
            sdpMLineIndex: ice.sdpMLineIndex,
          ),
        );
      }
      _pendingLocalIce.clear();
      if (!mounted) return;
      setState(() => _phase = 'Calling the GlobalNetwork desk…');
      _ringTimeout = Timer(const Duration(seconds: 50), () {
        if (_connectedAt != null || _hanging) return;
        unawaited(_hangup(status: 'missed'));
      });
      _iceSub = widget.api.watchIceAnswer(widget.customerId, callId).listen((data) {
        final value = (data['candidate'] as String?) ?? '';
        if (value.isEmpty) return;
        final ice = RTCIceCandidate(
          value,
          data['sdpMid'] as String?,
          (data['sdpMLineIndex'] as num?)?.toInt(),
        );
        if (!_remoteReady) {
          _pendingRemoteIce.add(ice);
          return;
        }
        unawaited(_pc?.addCandidate(ice));
      });
      _callSub = widget.api.watchCall(widget.customerId, callId).listen((data) async {
        if (data == null || !mounted) return;
        final status = (data['status'] as String?) ?? '';
        final recording = data['recording'] == true;
        if (recording != _recording) setState(() => _recording = recording);
        if (status == 'ended' || status == 'missed') {
          if (!_hanging) await _hangup(pop: true, notify: false);
          return;
        }
        final answer = (data['answerSdp'] as String?) ?? '';
        if (answer.isNotEmpty && !_remoteReady) {
          await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
          _remoteReady = true;
          for (final ice in _pendingRemoteIce) {
            await pc.addCandidate(ice);
          }
          _pendingRemoteIce.clear();
          _ringTimeout?.cancel();
          _connectedAt = DateTime.now();
          _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
            if (mounted) setState(() {});
          });
          if (mounted) setState(() => _phase = 'Connected');
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _phase = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _hangup({bool pop = true, bool notify = true, String status = 'ended'}) async {
    if (_hanging) return;
    _hanging = true;
    _ticker?.cancel();
    _ringTimeout?.cancel();
    final callId = _callId;
    if (notify && callId != null) {
      try {
        await widget.api.hangupCall(
          customerId: widget.customerId,
          callId: callId,
          status: _connectedAt == null && status == 'ended' ? 'missed' : status,
        );
      } catch (_) {}
    }
    try {
      await _pc?.close();
    } catch (_) {}
    _pc = null;
    try {
      await _local?.dispose();
    } catch (_) {}
    _local = null;
    if (pop && mounted) Navigator.of(context).maybePop();
  }

  String get _clock {
    final started = _connectedAt;
    if (started == null) return 'Ringing';
    final total = DateTime.now().difference(started).inSeconds;
    final m = (total ~/ 60).toString().padLeft(2, '0');
    final s = (total % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF050816),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: const Text('Call desk'),
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
        child: Column(
          children: [
            const Spacer(),
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: GnTheme.cyan.withValues(alpha: 0.5)),
                color: const Color(0xFF0B1F4A),
              ),
              child: Icon(_failed ? Icons.call_end : Icons.phone_in_talk, size: 44, color: GnTheme.cyan),
            ),
            const SizedBox(height: 24),
            const Text('GlobalNetwork desk', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(_phase, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, height: 1.4)),
            const SizedBox(height: 8),
            Text(_clock, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: GnTheme.cyan)),
            SizedBox(width: 1, height: 1, child: RTCVideoView(_remote)),
            if (_recording) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0x33F87171),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'The desk is recording this call for your account.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFFFCA5A5), fontWeight: FontWeight.w600),
                ),
              ),
            ],
            const Spacer(),
            FilledButton.icon(
              onPressed: _hanging ? null : () => _hangup(),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFF87171),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 28),
              ),
              icon: const Icon(Icons.call_end),
              label: Text(_failed ? 'Close' : 'Hang up'),
            ),
          ],
        ),
      ),
    );
  }
}
