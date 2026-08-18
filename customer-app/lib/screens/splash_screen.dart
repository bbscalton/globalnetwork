import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';

const splashMinDuration = Duration(milliseconds: 2500);
const splashFadeOut = Duration(milliseconds: 420);

class BrandSplash extends StatefulWidget {
  const BrandSplash({
    super.key,
    required this.firebaseReady,
    required this.childBuilder,
  });

  final Future<bool> firebaseReady;
  final Widget Function(bool firebaseOk) childBuilder;

  @override
  State<BrandSplash> createState() => _BrandSplashState();
}

class _BrandSplashState extends State<BrandSplash> with TickerProviderStateMixin {
  late final AnimationController _spin;
  late final AnimationController _pulse;
  late final AnimationController _intro;
  late final AnimationController _outro;

  Widget? _next;
  var _showSplash = true;
  Timer? _minHold;
  var _holdDone = false;

  @override
  void initState() {
    super.initState();
    _spin = AnimationController(vsync: this, duration: const Duration(seconds: 14))..repeat();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat(reverse: true);
    _intro = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..forward();
    _outro = AnimationController(vsync: this, duration: splashFadeOut);
    _run();
  }

  Future<void> _run() async {
    final hold = Completer<void>();
    _minHold = Timer(splashMinDuration, () {
      _holdDone = true;
      if (!hold.isCompleted) hold.complete();
    });
    final ok = await widget.firebaseReady;
    if (!mounted) return;
    if (!_holdDone) await hold.future;
    if (!mounted) return;
    setState(() => _next = widget.childBuilder(ok));
    await _outro.forward();
    if (!mounted) return;
    _spin.stop();
    _pulse.stop();
    setState(() => _showSplash = false);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _spin.stop();
      _spin.value = 0;
      _pulse.stop();
      _pulse.value = 0.35;
    }
  }

  @override
  void dispose() {
    _minHold?.cancel();
    _spin.dispose();
    _pulse.dispose();
    _intro.dispose();
    _outro.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final next = _next;
    if (!_showSplash && next != null) return next;
    return Stack(
      fit: StackFit.expand,
      children: [
        if (next != null) next,
        if (_showSplash)
          FadeTransition(
            opacity: ReverseAnimation(_outro),
            child: AbsorbPointer(child: _SplashCanvas(spin: _spin, pulse: _pulse, intro: _intro)),
          ),
      ],
    );
  }
}

class _SplashCanvas extends StatelessWidget {
  const _SplashCanvas({
    required this.spin,
    required this.pulse,
    required this.intro,
  });

  final Animation<double> spin;
  final Animation<double> pulse;
  final Animation<double> intro;

  @override
  Widget build(BuildContext context) {
    final titleIn = CurvedAnimation(
      parent: intro,
      curve: const Interval(0.28, 0.78, curve: Curves.easeOutCubic),
    );
    final tagIn = CurvedAnimation(
      parent: intro,
      curve: const Interval(0.42, 0.92, curve: Curves.easeOutCubic),
    );
    final lineIn = CurvedAnimation(
      parent: intro,
      curve: const Interval(0.55, 1.0, curve: Curves.easeOutCubic),
    );

    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.12),
          radius: 1.08,
          colors: [
            Color(0xFF0B1F4A),
            GnTheme.navy,
            Color(0xFF02040C),
          ],
          stops: [0.0, 0.48, 1.0],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 5),
            AnimatedBuilder(
              animation: Listenable.merge([spin, pulse]),
              builder: (context, child) {
                final glow = 0.22 + 0.28 * pulse.value;
                return Transform.rotate(
                  angle: spin.value * 2 * math.pi,
                  child: Container(
                    width: 168,
                    height: 168,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: GnTheme.cyan.withValues(alpha: glow),
                          blurRadius: 28 + 22 * pulse.value,
                          spreadRadius: 2 + 8 * pulse.value,
                        ),
                        BoxShadow(
                          color: GnTheme.cyan.withValues(alpha: 0.12 + 0.1 * pulse.value),
                          blurRadius: 64,
                          spreadRadius: 12,
                        ),
                      ],
                    ),
                    child: child,
                  ),
                );
              },
              child: Image.asset(
                'assets/logo-gn.png',
                width: 168,
                height: 168,
                filterQuality: FilterQuality.high,
                errorBuilder: (_, __, ___) => const Icon(Icons.public, size: 120, color: GnTheme.cyan),
              ),
            ),
            const SizedBox(height: 28),
            FadeTransition(
              opacity: titleIn,
              child: SlideTransition(
                position: Tween<Offset>(begin: const Offset(0, 0.12), end: Offset.zero).animate(titleIn),
                child: const Text(
                  'GlobalNetwork',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            FadeTransition(
              opacity: tagIn,
              child: SlideTransition(
                position: Tween<Offset>(begin: const Offset(0, 0.16), end: Offset.zero).animate(tagIn),
                child: Text(
                  'Internet in Antigua · billed in EC\$',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.78),
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            FadeTransition(
              opacity: lineIn,
              child: Text(
                'Your days. Your line.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: GnTheme.cyan.withValues(alpha: 0.9),
                  letterSpacing: 0.6,
                ),
              ),
            ),
            const Spacer(flex: 6),
          ],
        ),
      ),
    );
  }
}
