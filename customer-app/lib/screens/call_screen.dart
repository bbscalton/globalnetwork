import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../services/api.dart';
import '../theme.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({super.key, required this.api, required this.customerId, this.preferVideo = false});

  final GnApi api;
  final String customerId;
  final bool preferVideo;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  RTCPeerConnection? _pc;
  MediaStream? _local;
  final _remote = RTCVideoRenderer();
  final _localPreview = RTCVideoRenderer();
  String? _callId;
  var _phase = 'Starting call…';
  var _recording = false;
  var _videoOn = false;
  var _ownerVideoVisible = false;
  var _customerCamOn = false;
  var _videoBusy = false;
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
  var _appliedOfferGen = 0;
  var _appliedAnswerGen = 0;
  var _renegotiating = false;

  @override
  void initState() {
    super.initState();
    unawaited(() async {
      await _remote.initialize();
      await _localPreview.initialize();
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
    unawaited(_localPreview.dispose());
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
      final offer = await pc.createOffer({'offerToReceiveAudio': true, 'offerToReceiveVideo': true});
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
      setState(() => _phase = widget.preferVideo ? 'Video calling the GlobalNetwork desk…' : 'Calling the GlobalNetwork desk…');
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
        if (!_remoteReady && _appliedAnswerGen == 0) {
          _pendingRemoteIce.add(ice);
          return;
        }
        unawaited(_pc?.addCandidate(ice));
      });
      _callSub = widget.api.watchCall(widget.customerId, callId).listen((data) async {
        if (data == null || !mounted || _hanging) return;
        final status = (data['status'] as String?) ?? '';
        final recording = data['recording'] == true;
        final videoActive = data['videoActive'] == true;
        final ownerVideoVisible = data['ownerVideoVisible'] == true;
        if (recording != _recording || videoActive != _videoOn || ownerVideoVisible != _ownerVideoVisible) {
          setState(() {
            _recording = recording;
            _videoOn = videoActive;
            _ownerVideoVisible = ownerVideoVisible;
          });
        }
        if (status == 'ended' || status == 'missed') {
          if (!_hanging) await _hangup(pop: true, notify: false);
          return;
        }
        final gen = (data['negotiationGen'] as num?)?.toInt() ?? 1;
        final offerFrom = (data['offerFrom'] as String?) ?? 'customer';
        final offer = (data['offerSdp'] as String?) ?? '';
        final answer = (data['answerSdp'] as String?) ?? '';

        if (!_remoteReady && answer.isNotEmpty && (status == 'in_call' || gen == 1)) {
          await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
          _remoteReady = true;
          _appliedAnswerGen = gen;
          _appliedOfferGen = gen;
          for (final ice in _pendingRemoteIce) {
            await pc.addCandidate(ice);
          }
          _pendingRemoteIce.clear();
          _ringTimeout?.cancel();
          _connectedAt = DateTime.now();
          _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) {
            if (mounted) setState(() {});
          });
          if (mounted) setState(() => _phase = widget.preferVideo ? 'Connected · turning camera on…' : 'Connected');
          if (widget.preferVideo) unawaited(_switchToVideo());
          return;
        }

        if (_remoteReady && !_renegotiating && offerFrom == 'owner' && gen > _appliedOfferGen && offer.isNotEmpty) {
          _renegotiating = true;
          try {
            await pc.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
            final ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            await widget.api.pushCallAnswer(
              customerId: widget.customerId,
              callId: callId,
              answerSdp: ans.sdp ?? '',
              negotiationGen: gen,
            );
            _appliedOfferGen = gen;
            _appliedAnswerGen = gen;
            if (mounted) setState(() => _videoOn = videoActive);
          } catch (_) {
            if (mounted) setState(() => _phase = 'Could not connect video from the desk.');
          } finally {
            _renegotiating = false;
          }
          return;
        }

        if (_remoteReady && !_renegotiating && offerFrom == 'customer' && gen > _appliedAnswerGen && answer.isNotEmpty) {
          _renegotiating = true;
          try {
            await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
            _appliedAnswerGen = gen;
            if (mounted) setState(() => _videoOn = videoActive);
          } catch (_) {
            if (mounted) setState(() => _phase = 'Could not refresh video on this call.');
          } finally {
            _renegotiating = false;
          }
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

  Future<void> _switchToVideo() async {
    if (!_remoteReady || _customerCamOn || _videoBusy || _hanging) return;
    final pc = _pc;
    final local = _local;
    final callId = _callId;
    if (pc == null || local == null || callId == null) return;
    setState(() => _videoBusy = true);
    try {
      final cam = await navigator.mediaDevices.getUserMedia({'video': true, 'audio': false});
      for (final track in cam.getVideoTracks()) {
        await pc.addTrack(track, local);
      }
      _localPreview.srcObject = local;
      final offer = await pc.createOffer({'offerToReceiveAudio': true, 'offerToReceiveVideo': true});
      await pc.setLocalDescription(offer);
      final nextGen = _appliedOfferGen + 1;
      await widget.api.pushCallOffer(
        customerId: widget.customerId,
        callId: callId,
        offerSdp: offer.sdp ?? '',
        negotiationGen: nextGen,
        videoActive: true,
      );
      _appliedOfferGen = nextGen;
      if (mounted) {
        setState(() {
          _videoOn = true;
          _customerCamOn = true;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _phase = 'Allow the camera to show video to the desk.');
    } finally {
      if (mounted) setState(() => _videoBusy = false);
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
        title: Text(widget.preferVideo || _videoOn || _customerCamOn ? 'Video call' : 'Call desk'),
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
        child: Column(
          children: [
            if (_videoOn || _customerCamOn) ...[
              Expanded(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(18),
                      child: ColoredBox(
                        color: const Color(0xFF0B1F4A),
                        child: _ownerVideoVisible
                            ? RTCVideoView(_remote, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover)
                            : const Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.support_agent, size: 72, color: GnTheme.cyan),
                                    SizedBox(height: 12),
                                    Text(
                                      'GlobalNetwork desk',
                                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white70),
                                    ),
                                    SizedBox(height: 4),
                                    Text('Voice support — camera off', style: TextStyle(color: Colors.white54, fontSize: 13)),
                                  ],
                                ),
                              ),
                      ),
                    ),
                    if (_customerCamOn)
                      Positioned(
                        right: 12,
                        bottom: 12,
                        width: 96,
                        height: 128,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: ColoredBox(
                            color: const Color(0xFF0B1F4A),
                            child: RTCVideoView(_localPreview, mirror: true, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ] else ...[
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
            ],
            const Text('GlobalNetwork desk', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(_phase, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, height: 1.4)),
            const SizedBox(height: 8),
            Text(_clock, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: GnTheme.cyan)),
            if (!_videoOn) SizedBox(width: 1, height: 1, child: RTCVideoView(_remote)),
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
            if (!_videoOn && !_customerCamOn) const Spacer(),
            if (!_failed && !_customerCamOn) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: !_remoteReady || _videoBusy || _hanging ? null : () => unawaited(_switchToVideo()),
                icon: const Icon(Icons.videocam),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF0EA5E9),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 22),
                ),
                label: Text(
                  _videoBusy
                      ? 'Turning camera on…'
                      : _remoteReady
                          ? 'Switch to video'
                          : 'Video after the desk answers',
                ),
              ),
            ],
            const SizedBox(height: 12),
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
