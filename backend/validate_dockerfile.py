#!/usr/bin/env python3
"""
Validate Dockerfile syntax and structure.

This script validates Dockerfiles without requiring Docker daemon.
It checks for common issues and best practices.
"""
import sys
from pathlib import Path


def validate_dockerfile(dockerfile_path: Path) -> tuple[bool, list[str]]:
    """
    Validate a Dockerfile.

    Returns:
        (is_valid, list of issues)
    """
    issues = []

    if not dockerfile_path.exists():
        return False, [f"Dockerfile not found: {dockerfile_path}"]

    content = dockerfile_path.read_text()

    # Check for required instructions
    required = ["FROM", "WORKDIR", "COPY", "EXPOSE", "CMD"]
    found = {inst: False for inst in required}

    # Check for security best practices
    has_non_root_user = False
    has_healthcheck = False

    # Check for apt-get cleanup (check whole file, not per-line)
    has_apt_get = "apt-get install" in content
    has_apt_cleanup = "rm -rf /var/lib/apt/lists/*" in content

    lines = content.split("\n")
    for i, line in enumerate(lines, 1):
        # Skip comments and empty lines
        if line.strip().startswith("#") or not line.strip():
            continue

        # Check for required instructions
        for inst in required:
            if line.strip().startswith(inst + " ") or line.strip().startswith(inst + "\t"):
                found[inst] = True

        # Check for non-root user
        if "USER" in line and "vtthought" in line:
            has_non_root_user = True

        # Check for healthcheck
        if "HEALTHCHECK" in line:
            has_healthcheck = True

    # Check for missing required instructions
    for inst, present in found.items():
        if not present:
            issues.append(f"Missing required instruction: {inst}")

    # Security checks
    if not has_non_root_user:
        issues.append("Security: Container runs as root (no USER instruction)")

    if not has_healthcheck:
        issues.append("Best practice: No HEALTHCHECK instruction")

    # Check for apt-get cleanup
    if has_apt_get and not has_apt_cleanup:
        issues.append("Best practice: apt-get install without cleanup (rm -rf /var/lib/apt/lists/*)")

    return len(issues) == 0, issues


def main():
    """Validate all Dockerfiles in the project."""
    print("=" * 60)
    print("VTThought Dockerfile Validation")
    print("=" * 60)

    dockerfiles = [
        Path("backend/Dockerfile"),
        Path("backend/Dockerfile.cpu"),
    ]

    all_valid = True

    for dockerfile_path in dockerfiles:
        print(f"\nValidating: {dockerfile_path}")
        print("-" * 40)

        is_valid, issues = validate_dockerfile(dockerfile_path)

        if is_valid:
            print("  ✓ PASS - No issues found")
        else:
            print("  ✗ FAIL - Issues found:")
            for issue in issues:
                print(f"    - {issue}")
            all_valid = False

    print("\n" + "=" * 60)
    if all_valid:
        print("Result: ALL Dockerfiles VALID")
        return 0
    else:
        print("Result: SOME Dockerfiles have issues")
        return 1


if __name__ == "__main__":
    sys.exit(main())
