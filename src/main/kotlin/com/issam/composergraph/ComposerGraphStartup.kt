package com.issam.composergraph

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.util.Alarm

/** Reloads the graph whenever composer.json / composer.lock / installed.json change on disk. */
class ComposerGraphStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        val service = project.getService(ComposerGraphService::class.java)
        val alarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, service)
        project.messageBus.connect(service).subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                if (service.panel == null) return
                val relevant = events.any {
                    val name = it.path.substringAfterLast('/')
                    name == "composer.lock" || name == "composer.json" ||
                        (name == "installed.json" && it.path.contains("/vendor/composer/"))
                }
                if (!relevant) return
                alarm.cancelAllRequests()
                alarm.addRequest({ service.panel?.reload() }, 600)
            }
        })
    }
}
