import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'models/customer.dart';
import 'screens/chat_screen.dart';
import 'screens/home_screen.dart';
import 'screens/issue_screen.dart';
import 'screens/login_screen.dart';
import 'services/api.dart';
import 'theme.dart';

/// Replace with your Firebase flutterfire options, then `flutterfire configure`.
const firebaseReady = false;
const r2BaseUrl = String.fromEnvironment(
  'R2_BASE',
  defaultValue: 'https://globalnetwork-media.workers.dev',
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (firebaseReady) {
    await Firebase.initializeApp();
  }
  runApp(const GlobalNetworkApp());
}

class GlobalNetworkApp extends StatelessWidget {
  const GlobalNetworkApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GlobalNetwork',
      theme: GnTheme.dark(),
      home: const Gate(),
    );
  }
}

class Gate extends StatefulWidget {
  const Gate({super.key});

  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  late final GnApi api;
  CustomerAccount? account;
  var tick = 0;

  @override
  void initState() {
    super.initState();
    api = GnApi(r2BaseUrl: r2BaseUrl);
    _listen();
  }

  void _listen() {
    api.watchCustomer().listen((value) {
      if (!mounted) return;
      setState(() => account = value);
      if (value != null) {
        api.heartbeat(value.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!firebaseReady) {
      return Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Image.asset('assets/logo-gn.png', width: 96, height: 96, errorBuilder: (_, __, ___) => const Icon(Icons.public, size: 72, color: GnTheme.cyan)),
              const SizedBox(height: 16),
              const Text('GlobalNetwork customer app', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              const Text(
                'Run `flutterfire configure` in customer-app/, set firebaseReady = true in lib/main.dart, then rebuild.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    if (api.user == null) {
      return LoginScreen(api: api, onReady: () => setState(() => tick++));
    }
    if (account == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('GlobalNetwork')),
        body: const Center(child: Text('No customer record for this email yet. Ask staff to create your account.')),
      );
    }
    return HomeScreen(
      account: account!,
      onChat: () {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(api: api, customerId: account!.id)));
      },
      onIssue: () {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => IssueScreen(api: api, customerId: account!.id)));
      },
      onSignOut: () async {
        await api.signOut();
        setState(() {
          account = null;
          tick++;
        });
      },
    );
  }
}
