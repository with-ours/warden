/**
 * Flake8 ecosystem catalog: exact rule IDs and descriptions.
 * Only includes rules from commonly-installed plugins.
 *
 * Organized by plugin prefix for easy lookup.
 */

export interface Flake8Rule {
  code: string;
  description: string;
  plugin: string;
}

/**
 * Core pycodestyle rules (E/W prefix).
 */
const PYCODESTYLE_RULES: Flake8Rule[] = [
  { code: 'E101', description: 'indentation contains mixed spaces and tabs', plugin: 'pycodestyle' },
  { code: 'E111', description: 'indentation is not a multiple of four', plugin: 'pycodestyle' },
  { code: 'E117', description: 'over-indented', plugin: 'pycodestyle' },
  { code: 'E201', description: 'whitespace after \'(\'', plugin: 'pycodestyle' },
  { code: 'E202', description: 'whitespace before \')\'', plugin: 'pycodestyle' },
  { code: 'E211', description: 'whitespace before \'(\'', plugin: 'pycodestyle' },
  { code: 'E225', description: 'missing whitespace around operator', plugin: 'pycodestyle' },
  { code: 'E231', description: 'missing whitespace after \',\'', plugin: 'pycodestyle' },
  { code: 'E251', description: 'unexpected spaces around keyword / parameter default', plugin: 'pycodestyle' },
  { code: 'E261', description: 'at least two spaces before inline comment', plugin: 'pycodestyle' },
  { code: 'E262', description: 'inline comment should start with \'# \'', plugin: 'pycodestyle' },
  { code: 'E265', description: 'block comment should start with \'# \'', plugin: 'pycodestyle' },
  { code: 'E266', description: 'too many leading \'#\' for block comment', plugin: 'pycodestyle' },
  { code: 'E271', description: 'multiple spaces after keyword', plugin: 'pycodestyle' },
  { code: 'E272', description: 'multiple spaces before keyword', plugin: 'pycodestyle' },
  { code: 'E301', description: 'expected 1 blank line before', plugin: 'pycodestyle' },
  { code: 'E302', description: 'expected 2 blank lines', plugin: 'pycodestyle' },
  { code: 'E303', description: 'too many blank lines', plugin: 'pycodestyle' },
  { code: 'E401', description: 'multiple imports on one line', plugin: 'pycodestyle' },
  { code: 'E402', description: 'module level import not at top of file', plugin: 'pycodestyle' },
  { code: 'E501', description: 'line too long', plugin: 'pycodestyle' },
  { code: 'E502', description: 'backslash is redundant between brackets', plugin: 'pycodestyle' },
  { code: 'E711', description: 'comparison to None', plugin: 'pycodestyle' },
  { code: 'E712', description: 'comparison to True/False', plugin: 'pycodestyle' },
  { code: 'E713', description: 'test for membership should be \'not in x\'', plugin: 'pycodestyle' },
  { code: 'E714', description: 'test for object identity should be \'is not\'', plugin: 'pycodestyle' },
  { code: 'E721', description: 'do not compare types, use isinstance()', plugin: 'pycodestyle' },
  { code: 'E722', description: 'do not use bare \'except\'', plugin: 'pycodestyle' },
  { code: 'E731', description: 'do not assign a lambda expression, use a def', plugin: 'pycodestyle' },
  { code: 'E741', description: 'ambiguous variable name', plugin: 'pycodestyle' },
  { code: 'E743', description: 'ambiguous function name', plugin: 'pycodestyle' },
  { code: 'W291', description: 'trailing whitespace', plugin: 'pycodestyle' },
  { code: 'W292', description: 'no newline at end of file', plugin: 'pycodestyle' },
  { code: 'W293', description: 'whitespace before \':\'', plugin: 'pycodestyle' },
  { code: 'W391', description: 'blank line at end of file', plugin: 'pycodestyle' },
  { code: 'W503', description: 'line break before binary operator', plugin: 'pycodestyle' },
  { code: 'W504', description: 'line break after binary operator', plugin: 'pycodestyle' },
  { code: 'W605', description: 'invalid escape sequence', plugin: 'pycodestyle' },
];

/**
 * pyflakes rules (F prefix).
 */
const PYFLAKES_RULES: Flake8Rule[] = [
  { code: 'F401', description: 'module imported but unused', plugin: 'pyflakes' },
  { code: 'F402', description: 'import module from line N shadowed by loop variable', plugin: 'pyflakes' },
  { code: 'F403', description: '\'from module import *\' used; unable to detect undefined names', plugin: 'pyflakes' },
  { code: 'F405', description: 'name may be undefined, or defined from star imports', plugin: 'pyflakes' },
  { code: 'F501', description: 'invalid % format string', plugin: 'pyflakes' },
  { code: 'F811', description: 'redefinition of unused variable', plugin: 'pyflakes' },
  { code: 'F821', description: 'undefined name', plugin: 'pyflakes' },
  { code: 'F841', description: 'local variable is assigned to but never used', plugin: 'pyflakes' },
  { code: 'F901', description: '\'raise NotImplemented\' should be \'raise NotImplementedError\'', plugin: 'pyflakes' },
];

/**
 * flake8-bugbear rules (B prefix).
 */
const BUGBEAR_RULES: Flake8Rule[] = [
  { code: 'B001', description: 'do not use bare \'except:\', it catches BaseException', plugin: 'flake8-bugbear' },
  { code: 'B002', description: 'Python does not support the unary prefix increment', plugin: 'flake8-bugbear' },
  { code: 'B003', description: 'assigning to os.environ doesn\'t clear the environment', plugin: 'flake8-bugbear' },
  { code: 'B004', description: 'using hasattr(x, \'__call__\') instead of callable(x)', plugin: 'flake8-bugbear' },
  { code: 'B005', description: 'using .strip() with multi-character strings is misleading', plugin: 'flake8-bugbear' },
  { code: 'B006', description: 'do not use mutable data structures for argument defaults', plugin: 'flake8-bugbear' },
  { code: 'B007', description: 'loop control variable not used within loop body', plugin: 'flake8-bugbear' },
  { code: 'B008', description: 'do not perform function call in argument defaults', plugin: 'flake8-bugbear' },
  { code: 'B009', description: 'do not call getattr with a constant attribute value', plugin: 'flake8-bugbear' },
  { code: 'B010', description: 'do not call setattr with a constant attribute value', plugin: 'flake8-bugbear' },
  { code: 'B011', description: 'do not call assert False, use assert with falsy value', plugin: 'flake8-bugbear' },
  { code: 'B012', description: 'return/break/continue inside finally blocks cause exceptions to be silenced', plugin: 'flake8-bugbear' },
  { code: 'B014', description: 'redundant exception types listed in except handler', plugin: 'flake8-bugbear' },
  { code: 'B015', description: 'pointless comparison (did you mean to assign?)', plugin: 'flake8-bugbear' },
  { code: 'B017', description: 'assertRaises(Exception) should be considered evil', plugin: 'flake8-bugbear' },
  { code: 'B018', description: 'found useless expression', plugin: 'flake8-bugbear' },
  { code: 'B019', description: 'use of functools.lru_cache on methods can lead to memory leaks', plugin: 'flake8-bugbear' },
  { code: 'B020', description: 'loop control variable overrides iterable it iterates', plugin: 'flake8-bugbear' },
  { code: 'B023', description: 'function uses a loop variable not bound in function definition', plugin: 'flake8-bugbear' },
  { code: 'B024', description: 'abstract base class without abstract methods', plugin: 'flake8-bugbear' },
  { code: 'B025', description: 'try-except-pass with no specific exception', plugin: 'flake8-bugbear' },
  { code: 'B026', description: 'star-arg unpacking after keyword argument is bad practice', plugin: 'flake8-bugbear' },
  { code: 'B028', description: 'no explicit stacklevel keyword argument found in warnings.warn()', plugin: 'flake8-bugbear' },
  { code: 'B029', description: 'using except (): with an empty tuple catches nothing', plugin: 'flake8-bugbear' },
  { code: 'B032', description: 'possible unintentional type annotation', plugin: 'flake8-bugbear' },
  { code: 'B033', description: 'sets should not contain duplicate items', plugin: 'flake8-bugbear' },
  { code: 'B034', description: 're.sub/subn/split must pass flags or count/maxsplit as keyword arguments', plugin: 'flake8-bugbear' },
  { code: 'B035', description: 'dict comprehension uses static key', plugin: 'flake8-bugbear' },
  { code: 'B039', description: 'ContextVar with mutable default value', plugin: 'flake8-bugbear' },
  { code: 'B904', description: 'within an except clause, raise from the original exception', plugin: 'flake8-bugbear' },
  { code: 'B905', description: 'zip() without an explicit strict= parameter', plugin: 'flake8-bugbear' },
];

/**
 * flake8-comprehensions rules (C4 prefix).
 */
const COMPREHENSIONS_RULES: Flake8Rule[] = [
  { code: 'C400', description: 'unnecessary generator, use list comprehension', plugin: 'flake8-comprehensions' },
  { code: 'C401', description: 'unnecessary generator, use set comprehension', plugin: 'flake8-comprehensions' },
  { code: 'C402', description: 'unnecessary generator, use dict comprehension', plugin: 'flake8-comprehensions' },
  { code: 'C403', description: 'unnecessary list comprehension, use set()', plugin: 'flake8-comprehensions' },
  { code: 'C404', description: 'unnecessary list comprehension, use dict()', plugin: 'flake8-comprehensions' },
  { code: 'C405', description: 'unnecessary literal, use set()', plugin: 'flake8-comprehensions' },
  { code: 'C406', description: 'unnecessary literal, use dict()', plugin: 'flake8-comprehensions' },
  { code: 'C408', description: 'unnecessary dict/list/tuple call, use literal', plugin: 'flake8-comprehensions' },
  { code: 'C409', description: 'unnecessary list passed to tuple(), use tuple literal', plugin: 'flake8-comprehensions' },
  { code: 'C410', description: 'unnecessary list passed to list(), remove outer call', plugin: 'flake8-comprehensions' },
  { code: 'C411', description: 'unnecessary list call around list comprehension', plugin: 'flake8-comprehensions' },
  { code: 'C413', description: 'unnecessary list/reversed call around sorted()', plugin: 'flake8-comprehensions' },
  { code: 'C414', description: 'unnecessary list/set/sorted/tuple call within list/set/sorted/tuple', plugin: 'flake8-comprehensions' },
  { code: 'C415', description: 'unnecessary subscript reversal of iterable', plugin: 'flake8-comprehensions' },
  { code: 'C416', description: 'unnecessary comprehension, use list/set/dict()', plugin: 'flake8-comprehensions' },
  { code: 'C417', description: 'unnecessary map usage, use generator/list comprehension', plugin: 'flake8-comprehensions' },
  { code: 'C418', description: 'unnecessary dict() call, use dict literal', plugin: 'flake8-comprehensions' },
  { code: 'C419', description: 'unnecessary comprehension in any()/all()', plugin: 'flake8-comprehensions' },
];

/**
 * flake8-bandit rules (S prefix, from bandit).
 */
const BANDIT_RULES: Flake8Rule[] = [
  { code: 'S101', description: 'use of assert detected', plugin: 'flake8-bandit' },
  { code: 'S102', description: 'use of exec detected', plugin: 'flake8-bandit' },
  { code: 'S103', description: 'permissive file permissions (chmod)', plugin: 'flake8-bandit' },
  { code: 'S104', description: 'possible binding to all interfaces', plugin: 'flake8-bandit' },
  { code: 'S105', description: 'possible hardcoded password', plugin: 'flake8-bandit' },
  { code: 'S106', description: 'possible hardcoded password in function argument', plugin: 'flake8-bandit' },
  { code: 'S107', description: 'possible hardcoded password in default value', plugin: 'flake8-bandit' },
  { code: 'S108', description: 'probable insecure usage of temp file/directory', plugin: 'flake8-bandit' },
  { code: 'S110', description: 'try-except-pass detected', plugin: 'flake8-bandit' },
  { code: 'S112', description: 'try-except-continue detected', plugin: 'flake8-bandit' },
  { code: 'S301', description: 'pickle usage detected (insecure deserialization)', plugin: 'flake8-bandit' },
  { code: 'S303', description: 'use of insecure MD2/MD4/MD5/SHA1 hash function', plugin: 'flake8-bandit' },
  { code: 'S307', description: 'use of eval() detected', plugin: 'flake8-bandit' },
  { code: 'S310', description: 'audit url open for permitted schemes', plugin: 'flake8-bandit' },
  { code: 'S311', description: 'standard pseudo-random generators not suitable for security', plugin: 'flake8-bandit' },
  { code: 'S314', description: 'using xml.etree.ElementTree to parse XML (vulnerable to attacks)', plugin: 'flake8-bandit' },
  { code: 'S324', description: 'use of insecure hash function (hashlib)', plugin: 'flake8-bandit' },
  { code: 'S501', description: 'requests with verify=False disabling SSL verification', plugin: 'flake8-bandit' },
  { code: 'S506', description: 'use of unsafe yaml load', plugin: 'flake8-bandit' },
  { code: 'S602', description: 'subprocess call with shell=True', plugin: 'flake8-bandit' },
  { code: 'S603', description: 'subprocess call without shell=True', plugin: 'flake8-bandit' },
  { code: 'S607', description: 'starting a process with a partial executable path', plugin: 'flake8-bandit' },
  { code: 'S608', description: 'possible SQL injection via string formatting', plugin: 'flake8-bandit' },
  { code: 'S609', description: 'possible wildcard injection in os.system/popen', plugin: 'flake8-bandit' },
  { code: 'S701', description: 'using jinja2 templates with autoescape disabled', plugin: 'flake8-bandit' },
];

/**
 * flake8-simplify rules (SIM prefix).
 */
const SIMPLIFY_RULES: Flake8Rule[] = [
  { code: 'SIM102', description: 'use a single if-statement instead of nested if-statements', plugin: 'flake8-simplify' },
  { code: 'SIM103', description: 'return the condition directly instead of if/else return True/False', plugin: 'flake8-simplify' },
  { code: 'SIM105', description: 'use contextlib.suppress instead of try-except-pass', plugin: 'flake8-simplify' },
  { code: 'SIM108', description: 'use ternary operator instead of if-else assignment', plugin: 'flake8-simplify' },
  { code: 'SIM110', description: 'use any() instead of for loop with break', plugin: 'flake8-simplify' },
  { code: 'SIM112', description: 'use os.environ[key] instead of os.environ.get(key) with default', plugin: 'flake8-simplify' },
  { code: 'SIM114', description: 'combine if-branches with same body', plugin: 'flake8-simplify' },
  { code: 'SIM115', description: 'use context handler for opening files', plugin: 'flake8-simplify' },
  { code: 'SIM117', description: 'use single with-statement for multiple context managers', plugin: 'flake8-simplify' },
  { code: 'SIM118', description: 'use \'key in dict\' instead of \'key in dict.keys()\'', plugin: 'flake8-simplify' },
  { code: 'SIM201', description: 'use \'not a == b\' instead of \'a != b\'', plugin: 'flake8-simplify' },
  { code: 'SIM210', description: 'use bool() instead of True if ... else False', plugin: 'flake8-simplify' },
  { code: 'SIM300', description: 'use \'variable == constant\' instead of \'constant == variable\' (Yoda)', plugin: 'flake8-simplify' },
  { code: 'SIM401', description: 'use dict.get() instead of if-else block', plugin: 'flake8-simplify' },
];

/**
 * flake8-return rules (R prefix).
 */
const RETURN_RULES: Flake8Rule[] = [
  { code: 'R501', description: 'do not explicitly return None in function if it is the only return value', plugin: 'flake8-return' },
  { code: 'R502', description: 'do not implicitly return None in function with other return values', plugin: 'flake8-return' },
  { code: 'R503', description: 'missing explicit return at end of function', plugin: 'flake8-return' },
  { code: 'R504', description: 'unnecessary variable assignment before return', plugin: 'flake8-return' },
  { code: 'R505', description: 'unnecessary else after return', plugin: 'flake8-return' },
];

/**
 * flake8-print rules (T prefix).
 */
const PRINT_RULES: Flake8Rule[] = [
  { code: 'T201', description: 'print() found', plugin: 'flake8-print' },
  { code: 'T203', description: 'pprint() found', plugin: 'flake8-print' },
];

/**
 * Combined catalog of all known flake8 rules.
 */
export const FLAKE8_CATALOG: Flake8Rule[] = [
  ...PYCODESTYLE_RULES,
  ...PYFLAKES_RULES,
  ...BUGBEAR_RULES,
  ...COMPREHENSIONS_RULES,
  ...BANDIT_RULES,
  ...SIMPLIFY_RULES,
  ...RETURN_RULES,
  ...PRINT_RULES,
];

/**
 * Look up a rule by its code.
 */
export function lookupRule(code: string): Flake8Rule | undefined {
  return FLAKE8_CATALOG.find((r) => r.code === code);
}

/**
 * Get all rules for a given plugin.
 */
export function getRulesByPlugin(plugin: string): Flake8Rule[] {
  return FLAKE8_CATALOG.filter((r) => r.plugin === plugin);
}

/**
 * Format the catalog as a reference string for LLM prompts.
 * Groups by plugin for readability.
 */
export function formatCatalogForPrompt(): string {
  const byPlugin = new Map<string, Flake8Rule[]>();
  for (const rule of FLAKE8_CATALOG) {
    const existing = byPlugin.get(rule.plugin) ?? [];
    existing.push(rule);
    byPlugin.set(rule.plugin, existing);
  }

  const sections: string[] = [];
  for (const [plugin, rules] of byPlugin) {
    const lines = rules.map((r) => `  ${r.code}: ${r.description}`);
    sections.push(`[${plugin}]\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Custom AST visitor template for flake8 custom rules.
 */
export const CUSTOM_RULE_TEMPLATE = `
import ast
from typing import Iterator, Tuple

class CustomChecker:
    """Custom flake8 checker."""
    name = 'custom-checker'
    version = '0.1.0'

    def __init__(self, tree: ast.AST) -> None:
        self._tree = tree

    def run(self) -> Iterator[Tuple[int, int, str, type]]:
        for node in ast.walk(self._tree):
            # TODO: implement check logic
            pass
`.trim();
