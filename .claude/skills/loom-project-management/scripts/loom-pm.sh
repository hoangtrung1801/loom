#!/usr/bin/env bash
# loom-pm.sh - short commands for everyday Loom task management.
#
# Wraps `loom find / read / set-properties / create` against the Task type of
# one space (default: the space named "projects"). Needs only `loom` and `jq`.
# Compatible with bash 3.2 (macOS).
#
# Environment:
#   LOOM_PM_SPACE  space name or id to use (default: projects)
#   LOOM_PM_LIMIT  max results per list query (default: 100)
#
# Write verbs never touch more than one object: a <query> must resolve to a
# single task, otherwise the candidates are listed and nothing is written.
#
# Filter keys in the live space are lowercase snake_case (status, task_priority,
# due_date); set-properties/create use display names (Status, Priority, Due date).

set -euo pipefail

LIMIT="${LOOM_PM_LIMIT:-100}"
DRY=()           # becomes (--dry-run) with -n
SP="" SPNAME=""  # resolved space id / name
RID="" RNAME=""  # resolved task id / name

usage() {
  cat <<'EOF'
usage: loom-pm.sh [-n|--dry-run] <command> [args]

list:
  open                      all open tasks (status not Done)
  active                    status = In Progress
  blocked                   status = Blocked
  review                    status = In Review
  high                      high priority and not Done
  overdue                   due date passed and not Done
  search <words...>         full-text search across tasks
  summary                   task counts per Status, overdue, high-priority open
  next                      triage: In Progress + high priority first, then To Do (max 5)
  show <query>              print one task (resolved by name)

write (add -n to preview; <query> must match exactly one task):
  move <query> <status>     todo|start|review|hold|block|done (and aliases)
  start <query>             = move <query> "In Progress"
  done <query>              = move <query> Done
  prio <query> <p>          p = high|medium|low
  due <query> <date>        today, tomorrow, weekday, +3d, ISO date
  new "<name>" [-p high|medium|low] [-s <status>] [-d <date>] [-b "<markdown>"]

  help                      this text

env: LOOM_PM_SPACE (name or id, default "projects"), LOOM_PM_LIMIT (default 100)
EOF
}

die() { echo "loom-pm: $1" >&2; exit "${2:-1}"; }
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

preflight() {
  command -v loom >/dev/null 2>&1 || die "'loom' not found on PATH"
  command -v jq >/dev/null 2>&1 || die "'jq' not found on PATH"
  loom auth status >/dev/null 2>&1 || die "loom is not paired or the app is not running (try: loom auth)"
}

resolve_space() {
  local want line name id out
  want="$(lc "${LOOM_PM_SPACE:-projects}")"
  out="$(loom spaces 2>&1)" || die "loom spaces failed: $out"
  while IFS= read -r line; do
    case "$line" in *" — "*) ;; *) continue ;; esac
    name="${line%% — *}"
    id="${line##* — }"
    if [ "$(lc "$name")" = "$want" ] || [ "$(lc "$id")" = "$want" ]; then
      SP="$id"; SPNAME="$name"
      echo "space: $SPNAME ($SP)" >&2
      return 0
    fi
  done <<EOF
$out
EOF
  die "space '${LOOM_PM_SPACE:-projects}' not found (set LOOM_PM_SPACE to a name or id)"
}

# find_json <filter> [query] [limit] -> JSON on stdout
find_json() {
  local args=(find --space "$SP" --type Task --limit "${3:-$LIMIT}" --json)
  [ -n "${1:-}" ] && args+=(--filter "$1")
  [ -n "${2:-}" ] && args+=(--query "$2")
  loom "${args[@]}"
}

# list_tasks <filter> : numbered list plus count
list_tasks() {
  local json total
  json="$(find_json "$1")" || exit 1
  printf '%s' "$json" | jq -r '.handles[] | "\(.n). \(.name)"'
  total="$(printf '%s' "$json" | jq -r '.total')"
  echo "$total task(s)"
  if [ "$(printf '%s' "$json" | jq -r '.has_more')" = "true" ]; then
    echo "(more than $LIMIT; raise LOOM_PM_LIMIT to see all)"
  fi
}

# count <filter> -> total number of matching tasks
count() { find_json "$1" "" 1 | jq -r '.total'; }

F_OPEN='status != "Done"'
F_HIGH='task_priority = "high" AND status != "Done"'
F_OVERDUE='due_date < today() AND due_date IS NOT EMPTY AND status != "Done"'

# resolve_one <query> : sets RID / RNAME, exits 1 (none) or 2 (ambiguous)
resolve_one() {
  local q="$1" json total exact n
  [ -n "$q" ] || die "missing <query>" 2
  # 1) exact name (case-sensitive) wins outright; skipped if the name has quotes/backslashes
  case "$q" in *'"'*|*'\'*) ;; *)
    json="$(find_json "name = \"$q\"" "" 2 2>/dev/null)" || json=""
    if [ -n "$json" ] && [ "$(printf '%s' "$json" | jq '.handles | length')" -eq 1 ]; then
      RID="$(printf '%s' "$json" | jq -r '.handles[0].id')"
      RNAME="$(printf '%s' "$json" | jq -r '.handles[0].name')"
      return 0
    fi
  ;; esac
  # 2) fuzzy full-text search; look at up to 100 hits so an exact (case-insensitive) name is not missed
  json="$(find_json "" "$q" 100)" || exit 1
  total="$(printf '%s' "$json" | jq '.total')"
  if [ "$(printf '%s' "$json" | jq '.handles | length')" -eq 0 ]; then
    echo "loom-pm: no task matches '$q'" >&2; exit 1
  fi
  if [ "$total" -gt 1 ]; then
    exact="$(printf '%s' "$json" | jq --arg q "$q" \
      '[.handles[] | select((.name | ascii_downcase) == ($q | ascii_downcase))]')"
    n="$(printf '%s' "$exact" | jq 'length')"
    if [ "$n" -eq 1 ]; then
      json="{\"handles\":$exact}"
    else
      echo "loom-pm: '$q' matches $total tasks, be more specific (nothing written; showing up to 20):" >&2
      printf '%s' "$json" | jq -r '.handles[0:20][] | "  \(.n). \(.name)"' >&2
      exit 2
    fi
  fi
  RID="$(printf '%s' "$json" | jq -r '.handles[0].id')"
  RNAME="$(printf '%s' "$json" | jq -r '.handles[0].name')"
}

norm_status() {
  local k
  k="$(lc "$1" | tr -d ' _-')"
  case "$k" in
    todo) echo "To Do" ;;
    start|doing|progress|inprogress) echo "In Progress" ;;
    review|inreview) echo "In Review" ;;
    hold|onhold) echo "On Hold" ;;
    block|blocked) echo "Blocked" ;;
    done|finish|finished) echo "Done" ;;
    *) die "unknown status '$1'. valid: todo, start (In Progress), review, hold, block, done" 2 ;;
  esac
}

norm_prio() {
  local k
  k="$(lc "$1")"
  case "$k" in
    high|medium|low) echo "$k" ;;
    *) die "unknown priority '$1'. valid: high, medium, low" 2 ;;
  esac
}

# set_prop <query> <Property name> <value> : resolve one task and set one property
set_prop() {
  local json out
  resolve_one "$1"
  json="$(jq -nc --arg k "$2" --arg v "$3" '{($k): $v}')"
  out="$(loom set-properties --space "$SP" --object "$RID" --set "$json" ${DRY[@]+"${DRY[@]}"} 2>&1)" \
    || { echo "loom-pm: $out" >&2; exit 1; }
  if [ ${#DRY[@]} -gt 0 ]; then
    echo "[dry-run] $RNAME: $2 -> $3"
    echo "  $out"
  else
    echo "$RNAME: $2 -> $3"
  fi
}

cmd_summary() {
  local s total
  printf '%-14s %s\n' "STATUS" "COUNT"
  for s in "To Do" "In Progress" "In Review" "On Hold" "Blocked" "Done"; do
    printf '%-14s %s\n' "$s" "$(count "status = \"$s\"")"
  done
  total="$(count "")"
  printf '%-14s %s\n' "-- all tasks" "$total"
  printf '%-14s %s\n' "-- overdue" "$(count "$F_OVERDUE")"
  printf '%-14s %s\n' "-- high open" "$(count "$F_HIGH")"
}

cmd_next() {
  local merged id name i=0 info
  merged="$(
    { find_json 'status = "In Progress"'
      find_json "$F_HIGH"
      find_json 'status = "To Do"'
    } | jq -s '[.[].handles[]]
               | reduce .[] as $h ([]; if any(.[]; .id == $h.id) then . else . + [$h] end)
               | .[0:5]'
  )"
  if [ "$(printf '%s' "$merged" | jq 'length')" -eq 0 ]; then
    echo "nothing to do"; return 0
  fi
  printf '%s' "$merged" | jq -r '.[] | [.id, .name] | @tsv' | while IFS="$(printf '\t')" read -r id name; do
    i=$((i + 1))
    info="$(loom read --space "$SP" --object "$id" --json 2>/dev/null \
      | jq -r '.properties | "\((.Status // ["-"])[0]), \((.Priority // ["-"])[0])"')" || info="?"
    echo "$i. $name [$info]"
  done
}

cmd_new() {
  local name="" prio="" status="To Do" due="" body="" json out
  [ $# -ge 1 ] || die "usage: new \"<name>\" [-p prio] [-s status] [-d date] [-b body]" 2
  name="$1"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      -p) [ $# -ge 2 ] || die "-p needs a value" 2; prio="$(norm_prio "$2")"; shift 2 ;;
      -s) [ $# -ge 2 ] || die "-s needs a value" 2; status="$(norm_status "$2")"; shift 2 ;;
      -d) [ $# -ge 2 ] || die "-d needs a value" 2; due="$2"; shift 2 ;;
      -b) [ $# -ge 2 ] || die "-b needs a value" 2; body="$2"; shift 2 ;;
      -n|--dry-run) DRY=(--dry-run); shift ;;
      *) die "unknown option '$1' for new" 2 ;;
    esac
  done
  json="$(jq -nc --arg s "$status" --arg p "$prio" --arg d "$due" \
    '{Status: $s} + (if $p != "" then {Priority: $p} else {} end) + (if $d != "" then {"Due date": $d} else {} end)')"
  local args=(create --space "$SP" --type Task --name "$name" --properties "$json")
  [ -n "$body" ] && args+=(--markdown "$body")
  out="$(loom "${args[@]}" ${DRY[@]+"${DRY[@]}"} 2>&1)" || { echo "loom-pm: $out" >&2; exit 1; }
  if [ ${#DRY[@]} -gt 0 ]; then
    echo "[dry-run] would create: $name (Status: $status${prio:+, Priority: $prio}${due:+, Due: $due})"
    echo "  $out"
  else
    echo "created: $name (Status: $status${prio:+, Priority: $prio}${due:+, Due: $due})"
    echo "  $out"
  fi
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -n|--dry-run) DRY=(--dry-run); shift ;;
      -h|--help) usage; exit 0 ;;
      *) break ;;
    esac
  done
  local cmd="${1:-help}" v json
  [ $# -gt 0 ] && shift
  case "$cmd" in help|-h|--help) usage; exit 0 ;; esac

  preflight
  resolve_space

  case "$cmd" in
    open)    list_tasks "$F_OPEN" ;;
    active)  list_tasks 'status = "In Progress"' ;;
    blocked) list_tasks 'status = "Blocked"' ;;
    review)  list_tasks 'status = "In Review"' ;;
    high)    list_tasks "$F_HIGH" ;;
    overdue) list_tasks "$F_OVERDUE" ;;
    search)
      [ $# -ge 1 ] || die "usage: search <words...>" 2
      json="$(find_json "" "$*")" || exit 1
      printf '%s' "$json" | jq -r '.handles[] | "\(.n). \(.name)"'
      echo "$(printf '%s' "$json" | jq -r '.total') task(s)"
      ;;
    summary) cmd_summary ;;
    next)    cmd_next ;;
    show)
      [ $# -ge 1 ] || die "usage: show <query>" 2
      resolve_one "$*"
      loom read --space "$SP" --object "$RID"
      ;;
    move)
      [ $# -eq 2 ] || die "usage: move <query> <status>" 2
      v="$(norm_status "$2")"
      set_prop "$1" Status "$v"
      ;;
    start)
      [ $# -ge 1 ] || die "usage: start <query>" 2
      set_prop "$*" Status "In Progress"
      ;;
    done)
      [ $# -ge 1 ] || die "usage: done <query>" 2
      set_prop "$*" Status "Done"
      ;;
    prio)
      [ $# -eq 2 ] || die "usage: prio <query> <high|medium|low>" 2
      v="$(norm_prio "$2")"
      set_prop "$1" Priority "$v"
      ;;
    due)
      [ $# -eq 2 ] || die "usage: due <query> <date>" 2
      set_prop "$1" "Due date" "$2"
      ;;
    new)     cmd_new "$@" ;;
    *)       usage >&2; die "unknown command '$cmd'" 2 ;;
  esac
}

main "$@"
