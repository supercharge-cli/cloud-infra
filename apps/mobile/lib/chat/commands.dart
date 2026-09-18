import '../api/models.dart';

const xibecodeBotCommands = <BotCommand>[
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

const superchargeBotCommands = <BotCommand>[
  BotCommand(command: 'new', description: 'Start a new conversation'),
  BotCommand(command: 'start', description: 'Resume this session'),
  BotCommand(command: 'stop', description: 'Pause agent turns'),
  BotCommand(command: 'status', description: 'Show daemon control state'),
  BotCommand(command: 'model', description: 'Inspect or set the requested model'),
  BotCommand(command: 'format', description: 'API format: chat_completions | messages | responses'),
  BotCommand(command: 'cmd', description: 'Run shell: /cmd <command>'),
  BotCommand(command: 'model', description: 'Inspect or set the chat model'),
  BotCommand(command: 'setup', description: 'Chat provider: use instance settings (or TUI /setup)'),
  BotCommand(command: 'isetup', description: 'Image provider: use instance settings (or TUI /isetup)'),
  BotCommand(command: 'imodels', description: 'Show or set the image model (/imodels flux)'),
  BotCommand(command: 'imagine', description: 'Generate an image (/imagine a sunset)'),
  BotCommand(command: 'update', description: 'Check for a Supercharge binary update (E2B)'),
  BotCommand(command: 'help', description: 'Show available commands'),
];

/// Legacy alias — XibeCode stock list.
const defaultBotCommands = xibecodeBotCommands;

List<BotCommand> defaultBotCommandsFor(AgentRuntime runtime) =>
    runtime == AgentRuntime.supercharge ? superchargeBotCommands : xibecodeBotCommands;

final _xibecodeSlashOnly = {
  'start',
  'help',
  'new',
  'reset',
  'clear',
  'stop',
  'compact',
  'status',
  'queue',
  'history',
  'models',
  'skills',
  'update',
  'mode',
};

final _superchargeSlashOnly = {
  'new',
  'start',
  'stop',
  'status',
  'help',
  'model',
  'format',
  'setup',
  'isetup',
  'imodels',
  'update',
};

/// Instant send from the palette — not all of these start an agent turn.
bool commandSendsImmediately(String command, {AgentRuntime runtime = AgentRuntime.xibecode}) {
  final set = runtime == AgentRuntime.supercharge ? _superchargeSlashOnly : _xibecodeSlashOnly;
  return set.contains(command);
}

/// Slash commands that must not lock the composer as "Thinking…".
/// `/new` / `/history` / `/help` finish immediately; treating them as a
/// long agent turn left the send button disabled after the pane cleared.
final _xibecodeNoAgentTurn = {
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
  'update',
};

final _superchargeNoAgentTurn = {
  'new',
  'start',
  'stop',
  'status',
  'help',
  'model',
  'format',
  'cmd',
  'setup',
  'isetup',
  'imodels',
  'update',
};

bool commandStartsAgentTurn(String command, {AgentRuntime runtime = AgentRuntime.xibecode}) {
  final set = runtime == AgentRuntime.supercharge ? _superchargeNoAgentTurn : _xibecodeNoAgentTurn;
  return !set.contains(command);
}

String? slashCommandName(String text) {
  final t = text.trim();
  if (!t.startsWith('/')) return null;
  final body = t.substring(1).trim();
  if (body.isEmpty) return null;
  final space = body.indexOf(RegExp(r'\s'));
  final cmd = (space < 0 ? body : body.substring(0, space)).toLowerCase();
  return cmd.replaceAll(RegExp(r'[^a-z0-9_].*$'), '');
}

bool isNewLaneCommand(String text, {AgentRuntime runtime = AgentRuntime.xibecode}) {
  final cmd = slashCommandName(text);
  if (cmd == 'new') return true;
  if (runtime == AgentRuntime.supercharge) return false;
  return cmd == 'reset' || cmd == 'clear';
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
