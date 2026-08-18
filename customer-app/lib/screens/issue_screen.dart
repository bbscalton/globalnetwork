import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api.dart';
import '../theme.dart';
import 'call_screen.dart';

class IssueScreen extends StatefulWidget {
  const IssueScreen({super.key, required this.api, required this.customerId});
  final GnApi api;
  final String customerId;

  @override
  State<IssueScreen> createState() => _IssueScreenState();
}

class _IssueScreenState extends State<IssueScreen> {
  final title = TextEditingController();
  final body = TextEditingController();
  String? status;
  bool busy = false;

  Future<void> _send() async {
    setState(() {
      busy = true;
      status = null;
    });
    try {
      final picker = ImagePicker();
      final photo = await picker.pickImage(
        source: kIsWeb ? ImageSource.gallery : ImageSource.camera,
        imageQuality: 75,
      );
      final urls = <String>[];
      final issueId = DateTime.now().millisecondsSinceEpoch.toString();
      if (photo != null) {
        final bytes = await photo.readAsBytes();
        final url = await widget.api.uploadIssuePhoto(
          customerId: widget.customerId,
          issueId: issueId,
          fileName: photo.name,
          bytes: bytes,
          contentType: 'image/jpeg',
        );
        urls.add(url);
      }
      await widget.api.createIssue(
        customerId: widget.customerId,
        title: title.text.trim().isEmpty ? 'Line issue' : title.text.trim(),
        body: body.text.trim(),
        photoUrls: urls,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() => status = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report issue')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Title')),
            const SizedBox(height: 12),
            TextField(controller: body, decoration: const InputDecoration(labelText: 'What happened?'), maxLines: 4),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : _send,
              style: FilledButton.styleFrom(backgroundColor: GnTheme.cyan, foregroundColor: GnTheme.navy),
              child: Text(busy ? 'Uploading…' : (kIsWeb ? 'Choose photo & submit' : 'Take photo & submit')),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => CallScreen(api: widget.api, customerId: widget.customerId),
                        ),
                      );
                    },
              icon: const Icon(Icons.phone_in_talk),
              label: const Text('Or call the desk'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => CallScreen(
                            api: widget.api,
                            customerId: widget.customerId,
                            preferVideo: true,
                          ),
                        ),
                      );
                    },
              icon: const Icon(Icons.videocam),
              label: const Text('Or start a video call'),
            ),
            if (status != null) Text(status!, style: const TextStyle(color: Colors.redAccent)),
          ],
        ),
      ),
    );
  }
}
