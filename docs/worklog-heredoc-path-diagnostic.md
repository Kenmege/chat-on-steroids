# Literal heredoc path diagnostic correction

The shell path-dialect diagnostic scanned a quoted Python heredoc as though every
path-looking string were a shell argument. A checkpoint sentence containing an
app virtual path therefore failed before the legitimate command could execute.

The correction uses the already bundled Bash parser to identify literal heredoc
bodies with quoted/escaped delimiters and exclude only those bodies from this
diagnostic. Expanding heredocs and malformed syntax retain the conservative scan.
The actual command remains byte-for-byte unchanged. Command policy, initial cwd
validation, execution permissions and filesystem sandbox decisions are unchanged.

Regression first failed with the expected virtual-path false positive. Tests cover
the quoted stdin case, a real virtual path after it, expanding dollar/backtick
substitutions, a quoted substitution literal, Unicode and incomplete syntax.
The expanded sandbox suite passes: 56 passed, 21 platform skips on macOS.
An earlier combined sandbox/MCP run passed 227 tests with 31 platform/opt-in skips;
the final production verification and package results belong in the update receipt.
