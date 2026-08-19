import '../api/models.dart';

const defaultBotCommands = <BotCommand>[
  BotCommand(command: 'start', description: 'Welcome + list commands'),
  BotCommand(command: 'help', description: 'Show available commands'),
  BotCommand(command: 'new', description: 'Start a new conversation (keeps previous in history)'),
  BotCommand(command: 'reset', description: 'Start a new conversation (same as /new)'),
  BotCommand(command: 'clear', description: 'Start a new conversation (same as /new)'),
  BotCommand(command: 'history', description: 'List or reopen past conversations'),
  BotCommand(command: 'stop', description: 'Interrupt run + kill active commands'),
  BotCommand(command: 'compact', description: 'Compact context and write a run handoff'),
  BotCommand(command: 'status', description: 'Workdir, busy state, progress'),
  BotCommand(command: 'queue', description: 'List or clear queued messages'),
  BotCommand(command: 'workdir', description: 'Show or set project directory'),
  BotCommand(command: 'progress', description: 'Tool progress updates on|off'),
  BotCommand(command: 'level', description: 'Rigor: yolo | default | strict'),
  BotCommand(command: 'model', description: 'Show or set model (/model name)'),
  BotCommand(command: 'models', description: 'List models from API'),
  BotCommand(command: 'skills', description: 'List skills (or /skills search q)'),
  BotCommand(command: 'skill', description: 'Show a skill: /skill <name>'),
  BotCommand(command: 'update', description: 'CLI update (E2B: install+restart)'),
  BotCommand(command: 'mode', description: 'Show runtime mode (default | e2b)'),
  BotCommand(command: 'cmd', description: 'Run shell: /cmd <command>'),
  BotCommand(command: 'sethome', description: 'Set this chat as cron home'),
  BotCommand(command: 'pair', description: 'Pairing: list | approve CODE'),
  BotCommand(command: 'once', description: 'Allow a pending dangerous command once'),
  BotCommand(command: 'session', description: 'Allow pending command for this session'),
  BotCommand(command: 'always', description: 'Always allow this command pattern'),
  BotCommand(command: 'deny', description: 'Deny a pending dangerous command'),
];

final _slashOnly = {'start', 'help', 'new', 'reset', 'clear', 'stop', 'compact', 'status', 'queue', 'history', 'models', 'skills', 'update', 'mode'};

/// Instant send from the palette — not all of these start an agent turn.
bool commandSendsImmediately(String command) => _slashOnly.contains(command);

/// Slash commands that must not lock the composer as "Thinking…".
/// `/new` / `/history` / `/help` finish immediately; treating them as a
/// long agent turn left the send button disabled after the pane cleared.
final _noAgentTurn = {
  'start',
  'help',
  'new',
  'reset',
  'clear',
  'stop',
  'status',
  'queue',
  'history',
  'models',
  'skills',
  'mode',
};

bool commandStartsAgentTurn(String command) => !_noAgentTurn.contains(command);

String? slashCommandName(String text) {
  final t = text.trim();
  if (!t.startsWith('/')) return null;
  final body = t.substring(1).trim();
  if (body.isEmpty) return null;
  final space = body.indexOf(RegExp(r'\s'));
  final cmd = (space < 0 ? body : body.substring(0, space)).toLowerCase();
  return cmd.replaceAll(RegExp(r'[^a-z0-9_].*$'), '');
}

bool isNewLaneCommand(String text) {
  final cmd = slashCommandName(text);
  return cmd == 'new' || cmd == 'reset' || cmd == 'clear';
}

List<BotCommand> filterCommands(List<BotCommand> all, String input) {
  var q = input.trim();
  if (q.startsWith('/')) q = q.substring(1);
  q = q.toLowerCase();
  if (q.isEmpty) return all;
  return all.where((c) {
    return c.command.startsWith(q) ||
        c.command.contains(q) ||
        c.description.toLowerCase().contains(q);
  }).toList();
}

/// True when the composer is a slash command draft (no space yet, or just "/").
bool showCommandPalette(String text) {
  if (!text.startsWith('/')) return false;
  if (text.contains('\n')) return false;
  final space = text.indexOf(' ');
  return space < 0;
}