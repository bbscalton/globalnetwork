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

  Future<void> _go() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (register) {
        await widget.api.register(email.text.trim(), password.text);
      } else {
        await widget.api.signIn(email.text.trim(), password.text);
      }
      widget.onReady();
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/logo-gn.png', width: 88, height: 88),
                const SizedBox(height: 16),
                const Text('GlobalNetwork', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                const Text('Check your internet days. Chat with the owner.', textAlign: TextAlign.center),
                const SizedBox(height: 24),
                TextField(controller: email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress),
                const SizedBox(height: 12),
                TextField(controller: password, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
                if (error != null) ...[
                  const SizedBox(height: 8),
                  Text(error!, style: const TextStyle(color: Colors.redAccent)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: busy ? null : _go,
                  style: FilledButton.styleFrom(backgroundColor: GnTheme.cyan, foregroundColor: GnTheme.navy),
                  child: Text(busy ? 'Please wait…' : (register ? 'Create account' : 'Sign in')),
                ),
                TextButton(
                  onPressed: () => setState(() => register = !register),
                  child: Text(register ? 'Have an account? Sign in' : 'New customer? Register'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
