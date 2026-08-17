import 'dart:math' as math;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../theme.dart';

String formatClock(int ms) {
  if (ms <= 0) return '';
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final minute = d.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${d.hour >= 12 ? 'PM' : 'AM'}';
}

String formatDuration(int ms) {
  final total = math.max(0, (ms / 1000).round());
  final m = (total ~/ 60).toString().padLeft(2, '0');
  final s = (total % 60).toString().padLeft(2, '0');
  return '$m:$s';
}

class ChatPlayback {
  ChatPlayback._();
  static final ChatPlayback instance = ChatPlayback._();

  AudioPlayer? voice;
  VideoPlayerController? video;

  Future<void> stopOthers({AudioPlayer? keepVoice, VideoPlayerController? keepVideo}) async {
    if (voice != null && voice != keepVoice) {
      await voice!.stop();
    }
    if (video != null && video != keepVideo && video!.value.isInitialized) {
      await video!.pause();
    }
    if (keepVoice != null) voice = keepVoice;
    if (keepVideo != null) video = keepVideo;
  }
}

class VoiceNoteBubble extends StatefulWidget {
  const VoiceNoteBubble({super.key, required this.url, required this.durationMs, required this.mine});

  final String url;
  final int durationMs;
  final bool mine;

  @override
  State<VoiceNoteBubble> createState() => _VoiceNoteBubbleState();
}

class _VoiceNoteBubbleState extends State<VoiceNoteBubble> {
  final player = AudioPlayer();
  var playing = false;
  Duration position = Duration.zero;
  Duration duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    duration = Duration(milliseconds: widget.durationMs);
    player.onPlayerStateChanged.listen((state) {
      if (!mounted) return;
      setState(() => playing = state == PlayerState.playing);
    });
    player.onDurationChanged.listen((value) {
      if (!mounted) return;
      if (value.inMilliseconds > 0) setState(() => duration = value);
    });
    player.onPositionChanged.listen((value) {
      if (!mounted) return;
      setState(() => position = value);
    });
    player.onPlayerComplete.listen((_) {
      if (!mounted) return;
      setState(() {
        playing = false;
        position = Duration.zero;
      });
    });
  }

  @override
  void dispose() {
    if (ChatPlayback.instance.voice == player) ChatPlayback.instance.voice = null;
    player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (playing) {
      await player.pause();
      return;
    }
    await ChatPlayback.instance.stopOthers(keepVoice: player);
    if (position == Duration.zero) {
      await player.play(UrlSource(widget.url));
    } else {
      await player.resume();
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = duration.inMilliseconds == 0 ? widget.durationMs : duration.inMilliseconds;
    final progress = total <= 0 ? 0.0 : (position.inMilliseconds / total).clamp(0.0, 1.0);
    final ink = widget.mine ? GnTheme.navy : Colors.white;
    return SizedBox(
      width: 220,
      child: Row(
        children: [
          Material(
            color: widget.mine ? GnTheme.navy : GnTheme.cyan,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _toggle,
              child: SizedBox(
                width: 44,
                height: 44,
                child: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: widget.mine ? GnTheme.cyan : GnTheme.navy),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                    value: progress,
                    minHeight: 6,
                    backgroundColor: ink.withValues(alpha: 0.18),
                    color: widget.mine ? GnTheme.navy : GnTheme.cyan,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  playing || position.inMilliseconds > 0 ? formatDuration(position.inMilliseconds) : formatDuration(total),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: ink.withValues(alpha: 0.8)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class VideoClipBubble extends StatefulWidget {
  const VideoClipBubble({super.key, required this.url, required this.mine});

  final String url;
  final bool mine;

  @override
  State<VideoClipBubble> createState() => _VideoClipBubbleState();
}

class _VideoClipBubbleState extends State<VideoClipBubble> {
  VideoPlayerController? controller;
  var failed = false;

  @override
  void initState() {
    super.initState();
    final next = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    controller = next;
    next.initialize().then((_) {
      if (!mounted) return;
      setState(() {});
    }).catchError((_) {
      if (!mounted) return;
      setState(() => failed = true);
    });
    next.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    if (ChatPlayback.instance.video == controller) ChatPlayback.instance.video = null;
    controller?.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    final player = controller;
    if (player == null || !player.value.isInitialized) return;
    if (player.value.isPlaying) {
      await player.pause();
      return;
    }
    await ChatPlayback.instance.stopOthers(keepVideo: player);
    await player.play();
  }

  @override
  Widget build(BuildContext context) {
    if (failed) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text('Could not play this clip'),
      );
    }
    final player = controller;
    if (player == null || !player.value.isInitialized) {
      return const SizedBox(
        width: 210,
        height: 140,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    final playing = player.value.isPlaying;
    final size = player.value.size;
    final ratio = size.width == 0 ? 16 / 9 : size.width / size.height;
    return GestureDetector(
      onTap: _toggle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: SizedBox(
          width: 228,
          child: AspectRatio(
            aspectRatio: ratio.clamp(0.7, 1.7),
            child: Stack(
              fit: StackFit.expand,
              children: [
                ColoredBox(color: Colors.black, child: VideoPlayer(player)),
                if (!playing)
                  Container(
                    color: Colors.black45,
                    child: const Center(
                      child: Icon(Icons.play_circle_fill_rounded, size: 56, color: Colors.white),
                    ),
                  ),
                Positioned(
                  right: 8,
                  bottom: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(99)),
                    child: Text(
                      formatDuration(player.value.duration.inMilliseconds),
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class LocationShareBubble extends StatelessWidget {
  const LocationShareBubble({
    super.key,
    required this.label,
    required this.lat,
    required this.lng,
    required this.mine,
  });

  final String label;
  final double lat;
  final double lng;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.location_on_rounded, color: mine ? GnTheme.navy : GnTheme.cyan),
        const SizedBox(width: 8),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.isEmpty ? 'Shared location' : label,
                style: TextStyle(fontWeight: FontWeight.w800, color: mine ? GnTheme.navy : Colors.white),
              ),
              Text(
                'Pin for the technician map',
                style: TextStyle(fontSize: 11, color: mine ? GnTheme.navy.withValues(alpha: 0.65) : Colors.white70),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class WaveformBars extends StatelessWidget {
  const WaveformBars({super.key, required this.t, this.color = GnTheme.cyan});

  final double t;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _WavePainter(t: t, color: color),
      size: const Size(double.infinity, 28),
    );
  }
}

class _WavePainter extends CustomPainter {
  _WavePainter({required this.t, required this.color});

  final double t;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const count = 22;
    final paint = Paint()
      ..color = color
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 3;
    final gap = size.width / count;
    for (var i = 0; i < count; i++) {
      final wave = (math.sin(t * 6 + i * 0.55) * 0.5 + 0.5);
      final h = 6 + wave * (size.height - 8);
      final x = gap * i + gap / 2;
      canvas.drawLine(Offset(x, size.height / 2 - h / 2), Offset(x, size.height / 2 + h / 2), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _WavePainter oldDelegate) => oldDelegate.t != t;
}
