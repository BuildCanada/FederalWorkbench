# Commit

Create a well-described commit.

## Steps

1. **Analyze all changes:**
   - Run `git status`, `git diff` (unstaged), and `git diff --cached` (staged)
   - Review the diffs to understand what changed and why

2. **Review and stage changes:**
   - Check for files that should NOT be committed:
     - `.env` or files with secrets/API keys
     - Log files, temp files, debug output
     - Files the user intentionally left unstaged
   - If all changes are safe to commit: `git add -A`
   - Otherwise, stage selectively: `git add <specific-files>`

3. **Write a commit message that:**
   - Uses conventional commit format: `(scope): subject`
   - Has an imperative subject under 50 chars (e.g., "Add feature" not "Added feature")
   - Includes a body explaining the "why" when the change isn't self-explanatory
   - Groups related changes coherently

4. **Commit using HEREDOC:**
   ```bash
   git commit -m "$(cat <<'EOF'
(scope): subject

Body explaining why, if needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
   ```

5. **Handle pre-commit hook failures:**
   If the commit fails due to pre-commit hook errors:
   - Review the error output to understand what failed
   - Ask: "Pre-commit hook failed. Fix the errors?" (Yes/No)
   - If Yes: Fix the errors, re-stage affected files, and retry the commit
   - If No: Abort

6. **Verify and show result:**
   - Run `git log -1 --stat` to display the commit
   - Confirm the commit was created successfully
