---
name: sql-injection
description: Detect SQL injection vulnerabilities from string concatenation in queries.
---

# SQL Injection Detection

Find SQL injection vulnerabilities where user input is concatenated or interpolated directly into SQL query strings.

## What to Look For

- String concatenation in SQL queries: `"SELECT * FROM users WHERE id = " + userId`
- Template literal interpolation: `` `SELECT * FROM users WHERE id = ${userId}` ``
- String formatting without parameterization

## What is Safe (Do Not Report)

- Parameterized queries with placeholders: `db.query("SELECT * FROM users WHERE id = ?", [userId])`
- ORM methods that handle escaping
- Queries with only static/constant values

## Output

Report each vulnerability with:
- Severity: `critical` (user input directly in query) or `high` (potential injection)
- Location: file and line number
- Brief description of the issue
