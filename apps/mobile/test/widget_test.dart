import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/main.dart';

void main() {
  testWidgets('app builds', (tester) async {
    await tester.pumpWidget(VectraApp());
    await tester.pump();
    expect(find.textContaining('Vectra'), findsWidgets);
  });
}
