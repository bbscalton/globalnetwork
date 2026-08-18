import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';

import '../models/customer.dart';
import '../services/api.dart';
import '../services/place.dart';
import '../theme.dart';
import 'chat_bubbles.dart';
import 'call_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.api, required this.customerId});

  final GnApi api;
  final String customerId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with SingleTickerProviderStateMixin {
  final draft = TextEditingController();
  final focus = FocusNode();
  final recorder = AudioRecorder();
  final picker = ImagePicker();
  late final AnimationController wave;

  var recording = false;
  var sending = false;
  DateTime? recordStarted;
  String? recordPath;
  Timer? tick;
  String? banner;

  @override
  void initState() {
    super.initState();
    wave = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();
    draft.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    tick?.cancel();
    wave.dispose();
    draft.dispose();
    focus.dispose();
    unawaited(recorder.dispose());
    super.dispose();
  }

  Duration get _elapsed {
    final started = recordStarted;
    if (started == null) return Duration.zero;
    return DateTime.now().difference(started);
  }

  void _flash(String text) {
    setState(() => banner = text);
  }

  Future<bool> _micReady() async {
    if (await recorder.hasPermission()) return true;
    _flash('Allow the microphone so you can send a voice note.');
    return false;
  }

  Future<void> _startRecord() async {
    if (recording || sending) return;
    focus.unfocus();
    if (!await _micReady()) return;
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/gn-voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
      await recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 96000, sampleRate: 44100, numChannels: 1),
        path: path,
      );
      HapticFeedback.mediumImpact();
      setState(() {
        recording = true;
        recordPath = path;
        recordStarted = DateTime.now();
        banner = null;
      });
      tick?.cancel();
      tick = Timer.periodic(const Duration(milliseconds: 200), (_) {
        if (!mounted || !recording) return;
        if (_elapsed.inSeconds >= 60) {
          unawaited(_stopRecord(send: true));
          return;
        }
        setState(() {});
      });
    } catch (e) {
      _flash('Could not start a voice note. ${e.toString().replaceFirst('Exception: ', '')}');
    }
  }

  Future<void> _stopRecord({required bool send}) async {
    tick?.cancel();
    if (!recording) return;
    final elapsed = _elapsed;
    String? path;
    try {
      path = await recorder.stop();
    } catch (_) {}
    path ??= recordPath;
    setState(() {
      recording = false;
      recordStarted = null;
      recordPath = null;
    });
    if (!send || path == null) {
      final file = path == null ? null : File(path);
      if (file != null && await file.exists()) await file.delete();
      return;
    }
    if (elapsed.inMilliseconds < 400) {
      _flash('Hold a little longer to record a voice note.');
      return;
    }
    await _uploadVoice(File(path), elapsed);
  }

  Future<void> _uploadVoice(File file, Duration elapsed) async {
    setState(() => sending = true);
    try {
      final bytes = await file.readAsBytes();
      final url = await widget.api.uploadChatFile(
        customerId: widget.customerId,
        fileName: 'voice.m4a',
        bytes: bytes,
        contentType: 'audio/mp4',
      );
      await widget.api.sendChatMessage(
        customerId: widget.customerId,
        text: 'Voice note',
        kind: 'voice',
        mediaUrl: url,
        durationMs: elapsed.inMilliseconds,
      );
      HapticFeedback.lightImpact();
    } catch (e) {
      _flash(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (await file.exists()) await file.delete();
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> _shareLocation() async {
    if (sending) return;
    focus.unfocus();
    setState(() => sending = true);
    try {
      final pin = await captureSitePin();
      await widget.api.sendChatMessage(
        customerId: widget.customerId,
        text: pin.label,
        kind: 'location',
        lat: pin.lat,
        lng: pin.lng,
      );
      HapticFeedback.lightImpact();
    } catch (e) {
      _flash(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> _sendText() async {
    final text = draft.text.trim();
    if (text.isEmpty || sending) return;
    draft.clear();
    setState(() => sending = true);
    try {
      await widget.api.sendChatMessage(customerId: widget.customerId, text: text, kind: 'text');
    } catch (e) {
      draft.text = text;
      _flash(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> _pickClip() async {
    focus.unfocus();
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: GnTheme.card,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 10, 8, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(99)),
              ),
              const SizedBox(height: 12),
              const Text('Short clip · 15 seconds', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(height: 8),
              ListTile(
                leading: const CircleAvatar(backgroundColor: Color(0x3322D3EE), child: Icon(Icons.videocam, color: GnTheme.cyan)),
                title: const Text('Record a clip'),
                subtitle: const Text('Show the line, the pole, or the room'),
                onTap: () => Navigator.pop(ctx, ImageSource.camera),
              ),
              ListTile(
                leading: const CircleAvatar(backgroundColor: Color(0x3322D3EE), child: Icon(Icons.video_library_outlined, color: GnTheme.cyan)),
                title: const Text('Choose a clip'),
                onTap: () => Navigator.pop(ctx, ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null) return;
    final file = await picker.pickVideo(source: source, maxDuration: const Duration(seconds: 15));
    if (file == null) return;
    await _uploadClip(file);
  }

  Future<void> _uploadClip(XFile file) async {
    setState(() => sending = true);
    VideoPlayerController? probe;
    try {
      try {
        probe = VideoPlayerController.file(File(file.path));
        await probe.initialize();
        if (probe.value.duration > const Duration(seconds: 16)) {
          _flash('Keep video clips to 15 seconds.');
          return;
        }
      } catch (_) {
        await probe?.dispose();
        probe = null;
      }
      final bytes = await file.readAsBytes();
      if (bytes.lengthInBytes > 28 * 1024 * 1024) {
        _flash('That clip is too large. Record a shorter 15-second clip.');
        return;
      }
      final url = await widget.api.uploadChatFile(
        customerId: widget.customerId,
        fileName: 'clip.mp4',
        bytes: bytes,
        contentType: file.mimeType ?? 'video/mp4',
      );
      await widget.api.sendChatMessage(
        customerId: widget.customerId,
        text: 'Video clip',
        kind: 'video',
        mediaUrl: url,
        durationMs: probe?.value.duration.inMilliseconds ?? 0,
      );
      HapticFeedback.lightImpact();
    } catch (e) {
      _flash(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      await probe?.dispose();
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final keyboard = mq.viewInsets.bottom;
    final nav = math.max(mq.padding.bottom, mq.viewPadding.bottom);
    final bottomInset = keyboard + nav + (keyboard == 0 && nav < 36 ? 48 : 0);
    return Scaffold(
      resizeToAvoidBottomInset: false,
      extendBody: true,
      backgroundColor: GnTheme.ink,
      appBar: AppBar(
        backgroundColor: const Color(0xCC071027),
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: GnTheme.cyan.withValues(alpha: 0.45)),
              ),
              clipBehavior: Clip.antiAlias,
              child: Image.asset(
                'assets/logo-gn.png',
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const Icon(Icons.public, color: GnTheme.cyan),
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('GlobalNetwork', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                  Text('Antigua desk · usually replies today', style: TextStyle(color: GnTheme.cyan, fontSize: 12)),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Call the desk',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => CallScreen(api: widget.api, customerId: widget.customerId)),
              );
            },
            icon: const Icon(Icons.phone_in_talk, color: GnTheme.cyan),
          ),
          IconButton(
            tooltip: 'Video call',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => CallScreen(api: widget.api, customerId: widget.customerId, preferVideo: true),
                ),
              );
            },
            icon: const Icon(Icons.videocam, color: GnTheme.cyan),
          ),
        ],
      ),
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF071027), Color(0xFF050816), Color(0xFF082032)],
          ),
        ),
        child: Column(
          children: [
            if (banner != null)
              Material(
                color: const Color(0x33F87171),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                  child: Row(
                    children: [
                      Expanded(child: Text(banner!, style: const TextStyle(color: Color(0xFFFCA5A5)))),
                      IconButton(onPressed: () => setState(() => banner = null), icon: const Icon(Icons.close, size: 18)),
                    ],
                  ),
                ),
              ),
            Expanded(
              child: StreamBuilder<List<ChatLine>>(
                stream: widget.api.watchChat(widget.customerId),
                builder: (context, snap) {
                  final lines = [...(snap.data ?? [])].reversed.toList();
                  if (lines.isEmpty) {
                    return const _EmptyChat();
                  }
                  return ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                    itemCount: lines.length,
                    itemBuilder: (context, i) => _Bubble(line: lines[i]),
                  );
                },
              ),
            ),
            if (sending)
              const LinearProgressIndicator(minHeight: 2, color: GnTheme.cyan, backgroundColor: Colors.transparent),
            Padding(
              padding: EdgeInsets.fromLTRB(10, 6, 10, 10 + bottomInset),
              child: recording ? _buildRecorder() : _buildComposer(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildComposer() {
    final hasText = draft.text.trim().isNotEmpty;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xF0101833),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: GnTheme.cyan.withValues(alpha: 0.22)),
        boxShadow: [
          BoxShadow(color: GnTheme.cyan.withValues(alpha: 0.12), blurRadius: 28, offset: const Offset(0, 8)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            IconButton(
              onPressed: sending ? null : _pickClip,
              tooltip: 'Short video clip',
              icon: const Icon(Icons.videocam_rounded, color: GnTheme.cyan),
            ),
            IconButton(
              onPressed: sending ? null : _shareLocation,
              tooltip: 'Share location',
              icon: const Icon(Icons.location_on_rounded, color: GnTheme.cyan),
            ),
            Expanded(
              child: TextField(
                controller: draft,
                focusNode: focus,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                keyboardAppearance: Brightness.dark,
                enabled: !sending,
                onSubmitted: (_) => _sendText(),
                style: const TextStyle(fontSize: 16, height: 1.35),
                decoration: const InputDecoration(
                  hintText: 'Message GlobalNetwork…',
                  filled: false,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 6, vertical: 14),
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                ),
              ),
            ),
            if (hasText)
              _RoundAction(
                color: GnTheme.cyan,
                icon: Icons.send_rounded,
                iconColor: GnTheme.navy,
                onPressed: sending ? null : _sendText,
              )
            else
              GestureDetector(
                onLongPressStart: (_) => _startRecord(),
                onLongPressEnd: (_) => _stopRecord(send: true),
                onLongPressCancel: () => _stopRecord(send: false),
                child: _RoundAction(
                  color: const Color(0xFF122A56),
                  icon: Icons.mic_none_rounded,
                  iconColor: GnTheme.cyan,
                  onPressed: sending ? null : _startRecord,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildRecorder() {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xF01A1230),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFF87171).withValues(alpha: 0.45)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        child: Row(
          children: [
            IconButton(
              onPressed: () => _stopRecord(send: false),
              icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFF87171)),
            ),
            Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFFF87171), shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Text(formatDuration(_elapsed.inMilliseconds), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(width: 10),
            Expanded(
              child: AnimatedBuilder(
                animation: wave,
                builder: (_, __) => WaveformBars(t: wave.value * math.pi * 2),
              ),
            ),
            _RoundAction(
              color: GnTheme.cyan,
              icon: Icons.send_rounded,
              iconColor: GnTheme.navy,
              onPressed: () => _stopRecord(send: true),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({required this.color, required this.icon, required this.iconColor, this.onPressed});

  final Color color;
  final IconData icon;
  final Color iconColor;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2, right: 2),
      child: Material(
        color: color,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(width: 46, height: 46, child: Icon(icon, color: iconColor)),
        ),
      ),
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.graphic_eq_rounded, size: 54, color: GnTheme.cyan),
            SizedBox(height: 16),
            Text('Talk to GlobalNetwork', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            SizedBox(height: 8),
            Text(
              'Send a message, a voice note, or a 15-second clip. It lands on the owner desk in Antigua.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, height: 1.45),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.line});

  final ChatLine line;

  @override
  Widget build(BuildContext context) {
    final mine = line.mine;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        child: Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: EdgeInsets.fromLTRB(line.isVideo ? 6 : 12, line.isVideo ? 6 : 10, line.isVideo ? 6 : 12, 8),
          decoration: BoxDecoration(
            gradient: mine
                ? const LinearGradient(colors: [Color(0xFF22D3EE), Color(0xFF67E8F9)])
                : const LinearGradient(colors: [Color(0xFF132048), Color(0xFF0B1F4A)]),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(22),
              topRight: const Radius.circular(22),
              bottomLeft: Radius.circular(mine ? 22 : 6),
              bottomRight: Radius.circular(mine ? 6 : 22),
            ),
            border: mine ? null : Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (!mine)
                const Padding(
                  padding: EdgeInsets.only(bottom: 4),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text('GlobalNetwork', style: TextStyle(color: GnTheme.cyan, fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
                ),
              if (line.isVoice && line.mediaUrl != null)
                VoiceNoteBubble(url: line.mediaUrl!, durationMs: line.durationMs, mine: mine)
              else if (line.isVideo && line.mediaUrl != null)
                VideoClipBubble(url: line.mediaUrl!, mine: mine)
              else if (line.isLocation)
                LocationShareBubble(label: line.text, lat: line.lat!, lng: line.lng!, mine: mine)
              else
                Text(
                  line.text,
                  style: TextStyle(
                    color: mine ? GnTheme.navy : Colors.white,
                    fontSize: 15.5,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                formatClock(line.createdAtMs),
                style: TextStyle(fontSize: 10, color: mine ? GnTheme.navy.withValues(alpha: 0.65) : Colors.white54),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
