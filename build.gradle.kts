import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Compile against the PhpStorm that is already installed on this machine.
        local(providers.gradleProperty("phpStormPath").get())
        instrumentationTools()
        pluginVerifier()
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

intellijPlatform {
    buildSearchableOptions = false
    pluginConfiguration {
        name = "Composer Dependency Graph"
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null }
        }
    }
    pluginVerification {
        ides {
            local(providers.gradleProperty("phpStormPath").get())
        }
    }
}

tasks {
    wrapper {
        gradleVersion = "8.10.2"
    }
}
