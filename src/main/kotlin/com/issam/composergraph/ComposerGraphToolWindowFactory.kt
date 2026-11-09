package com.issam.composergraph

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class ComposerGraphToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val service = project.getService(ComposerGraphService::class.java)
        val panel = ComposerGraphPanel(project, toolWindow.disposable)
        service.panel = panel

        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        toolWindow.contentManager.addContent(content)

        toolWindow.setTitleActions(
            listOf(object : AnAction("Reload Composer Graph", "Re-read composer.lock", AllIcons.Actions.Refresh), DumbAware {
                override fun actionPerformed(e: AnActionEvent) = panel.reload()
                override fun getActionUpdateThread() = ActionUpdateThread.BGT
            }),
        )
    }
}
