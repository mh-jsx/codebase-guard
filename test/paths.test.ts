import assert from "node:assert/strict";
import test from "node:test";
import { isRelevantFile, isSensitiveConfig } from "../src/scanner/paths";

test("common framework and package configuration files are scanned", () => {
  for (const path of [
    "composer.json",
    "artisan",
    "config/app.php",
    "routes/web.php",
    "bootstrap/app.php",
    "pyproject.toml",
    "requirements-dev.txt",
    "Pipfile",
    "Gemfile",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle.kts"
  ]) {
    assert.equal(isRelevantFile(path), true, `${path} should be scanned`);
  }
});

test("Laravel execution-sensitive paths receive configuration context", () => {
  for (const path of ["config/app.php", "routes/console.php", "bootstrap/app.php", "app/Console/Kernel.php"]) {
    assert.equal(isSensitiveConfig(path), true, `${path} should be treated as sensitive configuration`);
  }
});
