import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../theme.dart';
import '../services/api.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onReady});

  final GnApi api;
  final VoidCallback onReady;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  String? error;
  bool busy = false;
  bool register = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  String _friendly(Object e) {
    if (e is FirebaseAuthException) {
      switch (e.code) {
        case 'account-exists-with-different-credential':
        case 'credential-already-in-use':
          return 'This email already has a password account. Sign in with email and password instead.';
        case 'user-not-found':
        case 'wrong-password':
        case 'invalid-credential':
          return 'Email or password is incorrect.';
        case 'weak-password':
          return 'Choose a longer password.';
        case 'email-already-in-use':
          return 'That email already has an account. Sign in instead, or use Google.';
        case 'network-request-failed':
          return 'No internet. Check your connection and try again.';
        case 'operation-not-allowed':
        case 'configuration-not-found':
          return 'Google sign-in is not enabled on this project yet.';
        case 'unauthorized-domain':
          return 'Add bbscalton.github.io in Firebase Console → Authentication → Settings → Authorized domains, then try Google again.';
        case 'popup-blocked':
          return 'The Google sign-in popup was blocked. Allow popups for this site and try again.';
        case 'popup-closed-by-user':
        case 'cancelled-popup-request':
          return 'Google sign-in was closed before it finished. Try again.';
        default:
          return e.message ?? e.code;
      }
    }
    return e.toString().replaceFirst('Exception: ', '');
  }

  Future<void> _run(Future<void> Function() work) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await work();
      widget.onReady();
    } catch (e) {
      setState(() => error = _friendly(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _go() {
    return _run(() async {
      if (register) {
        await widget.api.register(email.text.trim(), password.text);
      } else {
        await widget.api.signIn(email.text.trim(), password.text);
      }
    });
  }

  Future<void> _google() => _run(widget.api.signInWithGoogle);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: SingleChildScrollView(
              child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/logo-gn.png', width: 88, height: 88),
                const SizedBox(height: 16),
                const Text('GlobalNetwork', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                const Text('Check your internet days. Chat with the owner.', textAlign: TextAlign.center),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: busy ? null : _google,
                    icon: const Icon(Icons.g_mobiledata, size: 28),
                    label: const Text('Continue with Google'),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Use the Gmail the owner saved on your record.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
                const SizedBox(height: 20),
                const Row(
                  children: [
                    Expanded(child: Divider()),
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 12),
                      child: Text('or email'),
                    ),
                    Expanded(child: Divider()),
                  ],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: email,
                  decoration: const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: password,
                  decoration: const InputDecoration(labelText: 'Password'),
                  obscureText: true,
                ),
                if (error != null) ...[
                  const SizedBox(height: 8),
                  Text(error!, style: const TextStyle(color: Colors.redAccent), textAlign: TextAlign.center),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: busy ? null : _go,
                  style: FilledButton.styleFrom(backgroundColor: GnTheme.cyan, foregroundColor: GnTheme.navy),
                  child: Text(busy ? 'Please wait…' : (register ? 'Create account' : 'Sign in')),
                ),
                TextButton(
                  onPressed: busy ? null : () => setState(() => register = !register),
                  child: Text(register ? 'Have an account? Sign in' : 'New customer? Register with email'),
                ),
              ],
            ),
            ),
          ),
        ),
      ),
    );
  }
}
