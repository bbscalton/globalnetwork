import 'package:flutter_test/flutter_test.dart';
import 'package:globalnetwork_customer/main.dart';

void main() {
  testWidgets('setup screen shows GlobalNetwork', (WidgetTester tester) async {
    await tester.pumpWidget(const GlobalNetworkApp(firebaseReady: false));
    expect(find.text('GlobalNetwork'), findsOneWidget);
  });
}
