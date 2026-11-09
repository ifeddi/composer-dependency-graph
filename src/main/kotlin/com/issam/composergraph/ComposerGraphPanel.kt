package com.issam.composergraph

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.ide.util.PropertiesComponent
import com.intellij.ide.ui.LafManagerListener
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import javax.swing.JComponent
import javax.swing.SwingConstants

/** Hosts the JCEF browser that renders the dependency graph (web/index.html + app.js + app.css). */
class ComposerGraphPanel(private val project: Project, parent: Disposable) : Disposable {
    private val gson = Gson()
    private val service = project.getService(ComposerGraphService::class.java)
    private val generation = AtomicInteger()

    @Volatile
    private var ready = false

    @Volatile
    private var pendingSelect: String? = null

    @Volatile
    private var disposed = false

    private var browser: JBCefBrowser? = null
    private var query: JBCefJSQuery? = null

    val component: JComponent

    init {
        Disposer.register(parent, this)
        if (JBCefApp.isSupported()) {
            val b = JBCefBrowser()
            browser = b
            Disposer.register(this, b)
            val q = JBCefJSQuery.create(b as JBCefBrowserBase)
            query = q
            Disposer.register(this, q)
            q.addHandler { message ->
                handleMessage(message)
                null
            }
            b.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cefBrowser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                    if (frame?.isMain != true || frame.url.isNullOrEmpty() || frame.url == "about:blank") return
                    ready = true
                    pendingSelect?.let {
                        pendingSelect = null
                        callSelect(it)
                    }
                }
            }, b.cefBrowser)
            component = b.component

            ApplicationManager.getApplication().messageBus.connect(this)
                .subscribe(LafManagerListener.TOPIC, LafManagerListener { reload() })
            reload()
        } else {
            component = JBLabel(
                "<html><center>The embedded browser (JCEF) is not available in this IDE runtime.<br>" +
                    "Use a JetBrains Runtime with JCEF support to see the Composer graph.</center></html>",
                SwingConstants.CENTER,
            )
        }
    }

    /** Re-reads the Composer files and re-renders the graph. */
    fun reload() {
        val b = browser ?: return
        val dir = service.resolveDir()
        val base = project.basePath?.let { Path.of(it) }
        val id = generation.incrementAndGet()
        ready = false
        ApplicationManager.getApplication().executeOnPooledThread {
            val data = if (dir == null) {
                JsonObject().apply { addProperty("error", "This project has no base directory.") }
            } else {
                ComposerDataLoader.load(dir)
            }
            val projects = if (base != null) ComposerDataLoader.findProjects(base) else emptyList()
            val html = buildHtml(data, projects)
            ApplicationManager.getApplication().invokeLater({
                if (!disposed && id == generation.get()) b.loadHTML(html)
            }, ModalityState.any())
        }
    }

    /** Switches to another composer project directory. */
    fun showDirectory(dir: Path) {
        if (service.composerDir == dir) return
        service.composerDir = dir
        reload()
    }

    /** Selects (and reveals) a package in the graph. */
    fun select(packageName: String) {
        if (ready) callSelect(packageName) else pendingSelect = packageName
    }

    private fun callSelect(packageName: String) {
        val b = browser ?: return
        b.cefBrowser.executeJavaScript(
            "window.cgSelect && window.cgSelect(${gson.toJson(packageName)})",
            b.cefBrowser.url,
            0,
        )
    }

    private fun buildHtml(data: JsonObject, projects: List<String>): String {
        val config = JsonObject().apply {
            addProperty("theme", if (JBColor.isBright()) "light" else "dark")
            add("projects", gson.toJsonTree(projects))
            val saved = PropertiesComponent.getInstance(project).getValue(STATE_KEY)
            add("state", runCatching { JsonParser.parseString(saved ?: "{}") }.getOrDefault(JsonObject()))
        }
        val payload = JsonObject().apply {
            add("data", data)
            add("config", config)
        }
        val bridge = query?.let { "window.cgBridge = function (msg) { ${it.inject("msg")} };" } ?: ""
        return resource("web/index.html")
            .replace("/*@CSS@*/", resource("web/app.css"))
            .replace("/*@JS@*/", resource("web/app.js"))
            .replace("/*@BRIDGE@*/", bridge)
            .replace("/*@PAYLOAD@*/", gson.toJson(payload))
    }

    private fun resource(path: String): String =
        javaClass.classLoader.getResourceAsStream(path)?.use { String(it.readAllBytes(), Charsets.UTF_8) }
            ?: error("Missing plugin resource $path")

    private fun handleMessage(message: String) {
        val obj = runCatching { JsonParser.parseString(message).asJsonObject }.getOrNull() ?: return
        when (obj.get("cmd")?.asString) {
            "open" -> openPackage(obj.get("name")?.asString)
            "web" -> obj.get("name")?.asString?.let { BrowserUtil.browse("https://packagist.org/packages/$it") }
            "reload" -> reload()
            "setDir" -> obj.get("path")?.asString?.let { showDirectory(Path.of(it)) }
            "state" -> obj.get("value")?.let { PropertiesComponent.getInstance(project).setValue(STATE_KEY, it.toString()) }
        }
    }

    private fun openPackage(name: String?) {
        val dir = service.resolveDir() ?: return
        val target = if (name.isNullOrEmpty()) dir.resolve("composer.json")
        else dir.resolve("vendor").resolve(name).resolve("composer.json")
        ApplicationManager.getApplication().invokeLater {
            val file = if (Files.isRegularFile(target)) LocalFileSystem.getInstance().refreshAndFindFileByNioFile(target) else null
            if (file != null) {
                OpenFileDescriptor(project, file).navigate(true)
            } else {
                NotificationGroupManager.getInstance().getNotificationGroup("Composer Graph")
                    .createNotification("Cannot open $target - run `composer install` first.", NotificationType.INFORMATION)
                    .notify(project)
            }
        }
    }

    override fun dispose() {
        disposed = true
        if (service?.panel === this) service.panel = null
    }

    companion object {
        private const val STATE_KEY = "composerGraph.state"
    }
}
