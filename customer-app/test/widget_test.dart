import 'package:flutter_test/flutter_test.dart';
import 'package:globalnetwork_customer/main.dart';

void main() {
  testWidgets('splash shows GlobalNetwork brand', (WidgetTester tester) async {
    await tester.pumpWidget(GlobalNetworkApp(firebaseReady: Future.value(false)));
    await tester.pump();
    expect(find.text('GlobalNetwork'), findsWidgets);
    expect(find.text('Internet in Antigua · billed in EC\$'), findsOneWidget);
    expect(find.text('Your days. Your line.'), findsOneWidget);
  });
}
