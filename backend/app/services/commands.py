"""
VTThought Voice Commands Service (ADR-008)

Parses and executes voice commands from transcriptions.
Implements keyword-based command detection.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.transcription import VoiceCommand

logger = logging.getLogger(__name__)


@dataclass
class Command:
    """Voice command ready for execution."""

    action: str
    params: dict | None = None
    terminal: bool = False


@dataclass
class ParsedTranscription:
    """Result of parsing transcription for commands."""

    text: str
    commands: list[Command]
    has_trailing_command: bool


@dataclass
class VoiceCommandDef:
    """Voice command definition."""

    triggers: list[str]
    action: str
    terminal: bool = False
    extract_params: bool = False
    param_pattern: str | None = None
    params: str | None = None  # JSON string of static params


# Voice command registry based on ADR-008 command categories
VOICE_COMMANDS: list[VoiceCommandDef] = [
    # Execution Commands (Terminal)
    VoiceCommandDef(
        triggers=["enter", "send", "submit", "run that", "execute"],
        action="terminal.send-enter",
        terminal=True,
    ),
    VoiceCommandDef(
        triggers=["cancel", "stop that", "abort"],
        action="terminal.send-ctrl-c",
        terminal=True,
    ),
    # Editing Commands
    VoiceCommandDef(
        triggers=["delete that", "undo", "scratch that"],
        action="undo",
    ),
    VoiceCommandDef(
        triggers=["clear line", "delete line"],
        action="editor.action.deleteLines",
    ),
    VoiceCommandDef(
        triggers=["select all"],
        action="editor.action.selectAll",
    ),
    VoiceCommandDef(
        triggers=["new line", "newline"],
        action="type",
        params='{"text": "\\n"}',
    ),
    VoiceCommandDef(
        triggers=["tab"],
        action="type",
        params='{"text": "\\t"}',
    ),
    VoiceCommandDef(
        triggers=["redo"],
        action="redo",
    ),
    VoiceCommandDef(
        triggers=["copy", "copy that"],
        action="editor.action.clipboardCopyAction",
    ),
    VoiceCommandDef(
        triggers=["cut", "cut that"],
        action="editor.action.clipboardCutAction",
    ),
    VoiceCommandDef(
        triggers=["paste"],
        action="editor.action.clipboardPasteAction",
    ),
    VoiceCommandDef(
        triggers=["select word"],
        action="editor.action.wordSelect.drag",
    ),
    VoiceCommandDef(
        triggers=["select line"],
        action="editor.action.selectLines",
    ),
    VoiceCommandDef(
        triggers=["duplicate line"],
        action="editor.action.duplicateSelection",
    ),
    VoiceCommandDef(
        triggers=["move line up", "move up"],
        action="editor.action.moveLinesUpAction",
    ),
    VoiceCommandDef(
        triggers=["move line down", "move down"],
        action="editor.action.moveLinesDownAction",
    ),
    VoiceCommandDef(
        triggers=["indent", "indent line"],
        action="editor.action.indentLines",
    ),
    VoiceCommandDef(
        triggers=["outdent", "unindent"],
        action="editor.action.outdentLines",
    ),
    # Navigation Commands
    VoiceCommandDef(
        triggers=["go to line"],
        action="workbench.action.gotoLine",
        extract_params=True,
        param_pattern=r"go to line (\d+)",
    ),
    VoiceCommandDef(
        triggers=["scroll up"],
        action="editorScroll",
        params='{"to": "up", "by": "line"}',
    ),
    VoiceCommandDef(
        triggers=["scroll down"],
        action="editorScroll",
        params='{"to": "down", "by": "line"}',
    ),
    VoiceCommandDef(
        triggers=["scroll to top"],
        action="editorScroll",
        params='{"to": "top"}',
    ),
    VoiceCommandDef(
        triggers=["scroll to bottom"],
        action="editorScroll",
        params='{"to": "bottom"}',
    ),
    VoiceCommandDef(
        triggers=["go to start", "go to beginning"],
        action="cursorHome",
    ),
    VoiceCommandDef(
        triggers=["go to end"],
        action="cursorEnd",
    ),
    # VS Code Commands
    VoiceCommandDef(
        triggers=["save file", "save"],
        action="workbench.action.files.save",
    ),
    VoiceCommandDef(
        triggers=["save all"],
        action="workbench.action.files.saveAll",
    ),
    VoiceCommandDef(
        triggers=["close file", "close tab"],
        action="workbench.action.closeActiveEditor",
    ),
    VoiceCommandDef(
        triggers=["close all"],
        action="workbench.action.closeAllEditors",
    ),
    VoiceCommandDef(
        triggers=["open terminal", "show terminal"],
        action="workbench.action.terminal.toggleTerminal",
    ),
    VoiceCommandDef(
        triggers=["new terminal"],
        action="workbench.action.terminal.new",
    ),
    VoiceCommandDef(
        triggers=["command palette"],
        action="workbench.action.showCommands",
    ),
    VoiceCommandDef(
        triggers=["file explorer", "show sidebar"],
        action="workbench.view.explorer",
    ),
    VoiceCommandDef(
        triggers=["search", "find in files"],
        action="workbench.view.search",
    ),
    VoiceCommandDef(
        triggers=["toggle sidebar", "hide sidebar"],
        action="workbench.action.toggleSidebarVisibility",
    ),
    VoiceCommandDef(
        triggers=["format document", "format code"],
        action="editor.action.formatDocument",
    ),
    VoiceCommandDef(
        triggers=["toggle word wrap"],
        action="editor.action.toggleWordWrap",
    ),
    # Dictation Control
    VoiceCommandDef(
        triggers=["stop listening", "pause"],
        action="vtthought.toggleRecording",
    ),
]


# Disambiguation for homophones (similar-sounding words)
HOMOPHONES: dict[str, list[str]] = {
    "enter": ["inter", "inner"],
    "send": ["sent", "scent"],
    "delete": ["the lead", "dilute"],
    "undo": ["un do", "and do"],
    "redo": ["re do", "re-do"],
    "copy": ["copy that", "copi"],
    "cut": ["cut that"],
    "paste": ["pace"],
    "select": ["salect", "select the"],
    "save": ["saev"],
    "close": ["clothes", "close the"],
    "scroll": ["skroll"],
    "format": ["form at"],
    "indent": ["in dent"],
    "tab": ["tabb"],
}


class CommandParser:
    """
    Parses voice commands from transcription.

    Implements keyword-based command detection from ADR-008.
    """

    def __init__(self, commands: list[VoiceCommandDef] | None = None) -> None:
        """
        Initialize command parser.

        Args:
            commands: Optional custom command list
        """
        self.commands = commands or VOICE_COMMANDS

    def parse(self, transcription: str) -> ParsedTranscription:
        """
        Parse transcription for voice commands.

        Removes detected commands from text and returns commands to execute.

        Args:
            transcription: Raw transcription text

        Returns:
            ParsedTranscription with cleaned text and commands
        """
        text = transcription
        found_commands: list[Command] = []

        # Check for commands at the end of transcription
        for cmd in self.commands:
            for trigger in cmd.triggers:
                # Build regex to match command at end
                escaped = re.escape(trigger)
                pattern = rf"\s*{escaped}\s*$"
                regex = re.compile(pattern, re.IGNORECASE)

                if regex.search(text):
                    # Remove command from text
                    text = regex.sub("", text).strip()

                    # Extract parameters if needed
                    params = None
                    if cmd.extract_params and cmd.param_pattern:
                        match = re.search(cmd.param_pattern, transcription, re.IGNORECASE)
                        if match:
                            params = {"lineNumber": int(match.group(1))}
                    elif cmd.params:
                        import json

                        try:
                            params = json.loads(cmd.params)
                        except json.JSONDecodeError:
                            params = None

                    found_commands.append(
                        Command(
                            action=cmd.action,
                            params=params,
                            terminal=cmd.terminal,
                        )
                    )

        # Reverse to execute in order spoken
        found_commands.reverse()

        return ParsedTranscription(
            text=text,
            commands=found_commands,
            has_trailing_command=len(found_commands) > 0,
        )

    def normalize(self, text: str) -> str:
        """
        Normalize text by applying homophone corrections.

        Args:
            text: Text to normalize

        Returns:
            Normalized text
        """
        normalized = text.lower()
        for correct, variants in HOMOPHONES.items():
            for variant in variants:
                normalized = normalized.replace(variant, correct)
        return normalized


def parse_voice_commands(transcription: str) -> tuple[str, list[dict]]:
    """
    Parse voice commands from transcription.

    Convenience function that returns cleaned text and command list.

    Args:
        transcription: Raw transcription text

    Returns:
        Tuple of (cleaned_text, commands_list)
    """
    parser = CommandParser()
    result = parser.parse(transcription)

    commands_list = []
    for cmd in result.commands:
        cmd_dict = {
            "action": cmd.action,
            "terminal": cmd.terminal,
        }
        if cmd.params:
            cmd_dict["params"] = cmd.params
        commands_list.append(cmd_dict)

    return result.text, commands_list
