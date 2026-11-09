package com.issam.composergraph

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/**
 * Reads composer.json / composer.lock (or vendor/composer/installed.json) and produces a trimmed JSON
 * payload for the web UI. All graph logic (aliases, reachability, layout...) lives in the UI code.
 */
object ComposerDataLoader {
    private val PACKAGE_FIELDS = listOf(
        "name", "version", "description", "type", "abandoned", "homepage",
        "require", "conflict", "replace", "provide",
    )
    private val ROOT_FIELDS = listOf(
        "name", "version", "description", "require", "require-dev", "conflict", "replace", "provide",
    )
    private val SKIPPED_DIRS = setOf("vendor", "node_modules", ".git", ".idea", "var", "cache", "build", "dist")

    fun load(dir: Path): JsonObject {
        val result = JsonObject()
        result.addProperty("dir", dir.toString())
        result.addProperty("dirName", dir.fileName?.toString() ?: dir.toString())

        val composerJson = dir.resolve("composer.json")
        val composerLock = dir.resolve("composer.lock")
        val installedJson = dir.resolve("vendor").resolve("composer").resolve("installed.json")

        if (!Files.isRegularFile(composerJson) && !Files.isRegularFile(composerLock)) {
            result.addProperty("error", "No composer.json or composer.lock found in $dir")
            return result
        }

        try {
            val root = JsonObject()
            if (Files.isRegularFile(composerJson)) {
                val parsed = readObject(composerJson)
                for (key in ROOT_FIELDS) parsed.get(key)?.let { root.add(key, it) }
            }
            result.add("root", root)

            val packages = JsonArray()
            when {
                Files.isRegularFile(composerLock) -> {
                    val lock = readObject(composerLock)
                    addPackages(packages, lock.get("packages"), dev = false)
                    addPackages(packages, lock.get("packages-dev"), dev = true)
                    result.addProperty("source", "lock")
                }
                Files.isRegularFile(installedJson) -> {
                    val installed = readElement(installedJson)
                    val list = if (installed.isJsonObject) installed.asJsonObject.get("packages") else installed
                    addPackages(packages, list, dev = false)
                    result.addProperty("source", "installed")
                    result.addProperty(
                        "notice",
                        "composer.lock not found - using vendor/composer/installed.json. Run `composer install` to generate a lock file.",
                    )
                }
                else -> {
                    result.addProperty("source", "json")
                    result.addProperty(
                        "notice",
                        "composer.lock not found - only the direct requirements of composer.json are shown. Run `composer install` for the full graph.",
                    )
                }
            }
            result.add("packages", packages)
        } catch (e: Exception) {
            result.addProperty("error", "Could not read Composer files in $dir: ${e.message}")
        }
        return result
    }

    /** Finds directories containing a composer.json (max depth 3), the project base first. */
    fun findProjects(base: Path): List<String> {
        val found = LinkedHashSet<String>()
        if (Files.isRegularFile(base.resolve("composer.json"))) found.add(base.toString())
        try {
            Files.walkFileTree(base, emptySet(), 3, object : SimpleFileVisitor<Path>() {
                override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                    if (dir != base && dir.fileName?.toString() in SKIPPED_DIRS) return FileVisitResult.SKIP_SUBTREE
                    if (found.size >= 50) return FileVisitResult.TERMINATE
                    if (Files.isRegularFile(dir.resolve("composer.json"))) found.add(dir.toString())
                    return FileVisitResult.CONTINUE
                }

                override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE
            })
        } catch (_: IOException) {
        }
        return found.toList()
    }

    private fun addPackages(target: JsonArray, source: JsonElement?, dev: Boolean) {
        if (source == null || !source.isJsonArray) return
        for (element in source.asJsonArray) {
            if (!element.isJsonObject) continue
            val pkg = element.asJsonObject
            if (!pkg.has("name")) continue
            val trimmed = JsonObject()
            for (key in PACKAGE_FIELDS) pkg.get(key)?.let { trimmed.add(key, it) }
            if (dev) trimmed.addProperty("dev", true)
            target.add(trimmed)
        }
    }

    private fun readElement(path: Path): JsonElement =
        Files.newBufferedReader(path).use { JsonParser.parseReader(it) }

    private fun readObject(path: Path): JsonObject {
        val element = readElement(path)
        require(element.isJsonObject) { "${path.fileName} is not a JSON object" }
        return element.asJsonObject
    }
}
