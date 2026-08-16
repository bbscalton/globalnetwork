import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../services/api.dart';
import '../theme.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.api, required this.customerId});
  final GnApi api;
  final String customerId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final draft = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chat with GlobalNetwork')),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<List<ChatLine>>(
              stream: widget.api.watchChat(widget.customerId),
              builder: (context, snap) {
                final lines = snap.data ?? [];
                return ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: lines.length,
                  itemBuilder: (context, i) {
                    final m = lines[i];
                    final mine = m.from == 'customer';
                    return Align(
                      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: mine ? GnTheme.cyan.withValues(alpha: 0.25) : GnTheme.card,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(m.text),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(child: TextField(controller: draft, decoration: const InputDecoration(hintText: 'Message…'))),
                IconButton(
                  onPressed: () async {
                    final text = draft.text.trim();
                    if (text.isEmpty) return;
                    draft.clear();
                    await widget.api.sendChat(widget.customerId, text);
                  },
                  icon: const Icon(Icons.send, color: GnTheme.cyan),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
