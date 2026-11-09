package com.issam.composergraph

import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import java.nio.file.Path

/**
 * Opens the Composer graph. From a composer.json / composer.lock (project view or editor) it targets that file's
 * directory; with the caret on a "vendor/package" string in composer.json it also selects that package.
 */
class ShowComposerGraphAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val visible = e.project != null && (!ActionPlaces.isPopupPlace(e.place) || isComposerFile(e.getData(CommonDataKeys.VIRTUAL_FILE)))
        e.presentation.isEnabledAndVisible = visible
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val service = project.getService(ComposerGraphService::class.java)
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)

        var dirToShow: Path? = null
        var select: String? = null
        if (isComposerFile(file)) {
            dirToShow = runCatching { file!!.parent.toNioPath() }.getOrNull()
            val editor = e.getData(CommonDataKeys.EDITOR)
            if (editor != null && file!!.name == "composer.json") {
                val doc = editor.document
                val line = doc.getLineNumber(editor.caretModel.offset)
                val start = doc.getLineStartOffset(line)
                val text = doc.getText(com.intellij.openapi.util.TextRange(start, doc.getLineEndOffset(line)))
                val col = editor.caretModel.offset - start
                select = PACKAGE_REGEX.findAll(text).firstOrNull { col in it.range.first..it.range.last + 1 }?.groupValues?.get(1)
            }
        }

        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID) ?: return
        toolWindow.activate {
            val panel = service.panel ?: return@activate
            dirToShow?.let { panel.showDirectory(it) }
            select?.let { panel.select(it) }
        }
    }

    private fun isComposerFile(file: VirtualFile?) = file != null && (file.name == "composer.json" || file.name == "composer.lock")

    companion object {
        const val TOOL_WINDOW_ID = "Composer Graph"
        private val PACKAGE_REGEX = Regex("\"([A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+)\"")
    }
}
