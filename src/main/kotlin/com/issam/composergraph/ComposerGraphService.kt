package com.issam.composergraph

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import java.nio.file.Path

/** Per-project state shared between the tool window, the action and the file listener. */
class ComposerGraphService(val project: Project) : Disposable {
    /** Directory containing the composer.json that is currently displayed (null = project base dir). */
    @Volatile
    var composerDir: Path? = null

    @Volatile
    var panel: ComposerGraphPanel? = null

    fun resolveDir(): Path? = composerDir ?: project.basePath?.let { Path.of(it) }

    override fun dispose() {
        panel = null
    }
}
