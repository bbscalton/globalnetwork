import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/customer.dart';
import '../services/api.dart';
import '../theme.dart';

class RegistrationWizard extends StatefulWidget {
  const RegistrationWizard({
    super.key,
    required this.api,
    required this.account,
    required this.onSignOut,
  });

  final GnApi api;
  final CustomerAccount account;
  final VoidCallback onSignOut;

  @override
  State<RegistrationWizard> createState() => _RegistrationWizardState();
}

class _RegistrationWizardState extends State<RegistrationWizard> {
  final name = TextEditingController();
  final phone = TextEditingController();
  final address = TextEditingController();
  final picker = ImagePicker();
  var step = 0;
  Uint8List? idBytes;
  Uint8List? billingBytes;
  String? error;
  var busy = false;

  static const titles = [
    'Join GlobalNetwork',
    'Your name',
    'Phone number',
    'Service address',
    'Photo of your ID',
    'Proof of billing address',
    'Review and send',
  ];

  @override
  void initState() {
    super.initState();
    name.text = widget.account.name;
    phone.text = widget.account.phone;
    address.text = widget.account.address;
  }

  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    address.dispose();
    super.dispose();
  }

  bool get _stepOk {
    switch (step) {
      case 1:
        return name.text.trim().length >= 2;
      case 2:
        return phone.text.trim().length >= 7;
      case 3:
        return address.text.trim().length >= 4;
      case 4:
        return idBytes != null;
      case 5:
        return billingBytes != null;
      default:
        return true;
    }
  }

  Future<void> _pick(bool idCard) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: const Text('Take photo'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final file = await picker.pickImage(source: source, imageQuality: 72, maxWidth: 1600);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() {
      if (idCard) {
        idBytes = bytes;
      } else {
        billingBytes = bytes;
      }
      error = null;
    });
  }

  Future<void> _submit() async {
    final idPhoto = idBytes;
    final billPhoto = billingBytes;
    if (idPhoto == null || billPhoto == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final idUrl = await widget.api.uploadKycPhoto(
        customerId: widget.account.id,
        kind: 'id',
        bytes: idPhoto,
      );
      final billUrl = await widget.api.uploadKycPhoto(
        customerId: widget.account.id,
        kind: 'billing',
        bytes: billPhoto,
      );
      await widget.api.submitApplication(
        customerId: widget.account.id,
        name: name.text.trim(),
        phone: phone.text.trim(),
        address: address.text.trim(),
        idPhotoUrl: idUrl,
        billingPhotoUrl: billUrl,
      );
    } catch (e) {
      setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Register for service'),
        actions: [TextButton(onPressed: widget.onSignOut, child: const Text('Sign out'))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          LinearProgressIndicator(
            value: (step + 1) / titles.length,
            color: GnTheme.cyan,
            backgroundColor: Colors.white12,
          ),
          const SizedBox(height: 16),
          Text('Step ${step + 1} of ${titles.length}', style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 6),
          Text(titles[step], style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          if (widget.account.approvalStatus == 'rejected' && widget.account.rejectionReason.isNotEmpty && step == 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                'GlobalNetwork asked you to resubmit: ${widget.account.rejectionReason}',
                style: const TextStyle(color: Color(0xFFF87171), height: 1.4),
              ),
            ),
          _body(),
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(error!, style: const TextStyle(color: Color(0xFFF87171))),
          ],
          const SizedBox(height: 24),
          Row(
            children: [
              if (step > 0)
                OutlinedButton(
                  onPressed: busy ? null : () => setState(() => step -= 1),
                  child: const Text('Back'),
                ),
              const Spacer(),
              FilledButton(
                onPressed: busy || !_stepOk
                    ? null
                    : () {
                        if (step < titles.length - 1) {
                          setState(() => step += 1);
                        } else {
                          _submit();
                        }
                      },
                style: FilledButton.styleFrom(backgroundColor: GnTheme.cyan, foregroundColor: GnTheme.navy),
                child: Text(busy ? 'Sending…' : (step == titles.length - 1 ? 'Send to GlobalNetwork' : 'Continue')),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _body() {
    switch (step) {
      case 0:
        return const Text(
          'After you sign in, tell us who you are and send a photo of your ID and a photo of a bill that shows your address. GlobalNetwork reviews this on the owner desk. Chat and line reports open only after they approve you and set your days from the payment they receive.',
          style: TextStyle(height: 1.45, fontSize: 16),
        );
      case 1:
        return TextField(
          controller: name,
          decoration: const InputDecoration(labelText: 'Full name'),
          textCapitalization: TextCapitalization.words,
          onChanged: (_) => setState(() {}),
        );
      case 2:
        return TextField(
          controller: phone,
          decoration: const InputDecoration(labelText: 'Mobile number'),
          keyboardType: TextInputType.phone,
          onChanged: (_) => setState(() {}),
        );
      case 3:
        return TextField(
          controller: address,
          decoration: const InputDecoration(labelText: 'Home / installation address'),
          maxLines: 3,
          onChanged: (_) => setState(() {}),
        );
      case 4:
        return _photoStep(
          label: 'Take a clear photo of a national ID, passport, or driver’s licence.',
          bytes: idBytes,
          onPick: () => _pick(true),
        );
      case 5:
        return _photoStep(
          label: 'Photo of a utility bill, bank letter, or other proof of this address.',
          bytes: billingBytes,
          onPick: () => _pick(false),
        );
      default:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(name.text.trim(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(phone.text.trim()),
            Text(address.text.trim()),
            const SizedBox(height: 16),
            const Text('ID and billing photos are attached. Send this to the owner desk for approval.'),
          ],
        );
    }
  }

  Widget _photoStep({required String label, required Uint8List? bytes, required VoidCallback onPick}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(height: 1.4)),
        const SizedBox(height: 16),
        if (bytes != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.memory(bytes, height: 220, width: double.infinity, fit: BoxFit.cover),
          ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: onPick,
          icon: const Icon(Icons.photo_camera),
          label: Text(bytes == null ? 'Add photo' : 'Replace photo'),
        ),
      ],
    );
  }
}
