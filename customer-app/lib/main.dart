import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'firebase_options.dart';
import 'models/customer.dart';
import 'screens/chat_screen.dart';
import 'screens/call_screen.dart';
import 'screens/home_screen.dart';
import 'screens/issue_screen.dart';
import 'screens/login_screen.dart';
import 'screens/payment_history_screen.dart';
import 'screens/pending_approval_screen.dart';
import 'screens/registration_wizard.dart';
import 'screens/settings_screen.dart';
import 'screens/splash_screen.dart';
import 'services/api.dart';
import 'theme.dart';

const r2BaseUrl = String.fromEnvironment(
  'R2_BASE',
  defaultValue: 'https://globalnetwork-media.neuereatec.workers.dev',
);

Future<bool> _initFirebase() async {
  if (!kFirebaseOptionsReady) return false;
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    return true;
  } catch (_) {
    return false;
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kIsWeb) {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarDividerColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.light,
        statusBarIconBrightness: Brightness.light,
      ),
    );
  }
  final firebaseReady = _initFirebase();
  runApp(GlobalNetworkApp(firebaseReady: firebaseReady));
}

class GlobalNetworkApp extends StatelessWidget {
  const GlobalNetworkApp({super.key, required this.firebaseReady});

  final Future<bool> firebaseReady;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GlobalNetwork',
      theme: GnTheme.dark(),
      home: BrandSplash(
        firebaseReady: firebaseReady,
        childBuilder: (ok) => ok ? const Gate() : const SetupScreen(),
      ),
    );
  }
}

class SetupScreen extends StatelessWidget {
  const SetupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/logo-gn.png',
              width: 96,
              height: 96,
              errorBuilder: (_, __, ___) => const Icon(Icons.public, size: 72, color: GnTheme.cyan),
            ),
            const SizedBox(height: 16),
            const Text('GlobalNetwork', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            const Text(
              'Run `flutterfire configure` in customer-app/, set kFirebaseOptionsReady = true in lib/firebase_options.dart, then rebuild.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
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
  User? user;
  CustomerAccount? account;
  String? linkError;
  var linking = false;
  StreamSubscription<User?>? _authSub;
  StreamSubscription<CustomerAccount?>? _customerSub;

  @override
  void initState() {
    super.initState();
    api = GnApi(r2BaseUrl: r2BaseUrl);
    _authSub = api.authChanges().listen((next) {
      if (!mounted) return;
      setState(() {
        user = next;
        account = null;
        linkError = null;
      });
      _customerSub?.cancel();
      if (next != null) {
        _bindCustomer();
      }
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _customerSub?.cancel();
    super.dispose();
  }

  Future<void> _bindCustomer() async {
    setState(() {
      linking = true;
      linkError = null;
    });
    try {
      final id = await api.linkAccount();
      await _customerSub?.cancel();
      _customerSub = api.watchCustomer(id).listen((value) {
        if (!mounted) return;
        setState(() => account = value);
        if (value != null) {
          api.heartbeat(value.id);
        }
      });
    } on FirebaseFunctionsException catch (e) {
      final raw = (e.message ?? e.code).trim();
      final looksInternal = e.code == 'internal' || raw.toLowerCase() == 'internal';
      setState(() {
        linkError = e.code == 'not-found'
            ? 'No customer record for this email yet. Ask the owner to create your account on the GlobalNetwork desk.'
            : looksInternal || e.code == 'unavailable'
                ? 'Could not open your account. Check your internet and try again.'
                : (e.message ?? e.code);
      });
    } catch (e) {
      final raw = e.toString();
      setState(() {
        linkError = raw.toLowerCase().contains('internal')
            ? 'Could not open your account. Check your internet and try again.'
            : raw.replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) setState(() => linking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (user == null) {
      return LoginScreen(api: api, onReady: () => setState(() {}));
    }
    if (linking && account == null) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Opening your account…'),
            ],
          ),
        ),
      );
    }
    if (account == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('GlobalNetwork')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.public, size: 64, color: GnTheme.cyan),
              const SizedBox(height: 16),
              const Text(
                'Your GlobalNetwork account',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              Text(
                linkError ?? 'Could not open your account yet.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: linking ? null : _bindCustomer,
                child: Text(linking ? 'Opening…' : 'Try again'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () async {
                  await api.signOut();
                  setState(() {
                    user = null;
                    account = null;
                  });
                },
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      );
    }
    Future<void> signOut() async {
      await api.signOut();
      setState(() {
        user = null;
        account = null;
      });
    }

    if (account!.needsRegistration) {
      return RegistrationWizard(api: api, account: account!, onSignOut: () => signOut());
    }
    if (account!.isPendingApproval) {
      return PendingApprovalScreen(account: account!, onSignOut: () => signOut());
    }
    return HomeScreen(
      account: account!,
      onChat: () {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(api: api, customerId: account!.id)));
      },
      onCall: () {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => CallScreen(api: api, customerId: account!.id)));
      },
      onVideoCall: () {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => CallScreen(api: api, customerId: account!.id, preferVideo: true)),
        );
      },
      onIssue: () {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => IssueScreen(api: api, customerId: account!.id)));
      },
      onPayments: () {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => PaymentHistoryScreen(api: api, customerId: account!.id)),
        );
      },
      onSettings: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => SettingsScreen(
              account: account!,
              onPaymentHistory: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => PaymentHistoryScreen(api: api, customerId: account!.id)),
                );
              },
              onSignOut: () => signOut(),
            ),
          ),
        );
      },
    );
  }
}
