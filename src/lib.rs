use zed_extension_api::{self as zed, LanguageServerId, Result};

struct SalesforceExtension;

impl zed::Extension for SalesforceExtension {
    fn new() -> Self {
        SalesforceExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        match language_server_id.as_ref() {
            "apex" => {
                let java = worktree
                    .which("java")
                    .ok_or_else(|| "Java not found on PATH. Please install Java 11+.".to_string())?;

                let work_dir = std::env::current_dir()
                    .map_err(|e| format!("could not get extension work directory: {e}"))?;
                let jar_path = work_dir.join("apex-jorje-lsp.jar");

                if !jar_path.exists() {
                    zed::set_language_server_installation_status(
                        language_server_id,
                        &zed::LanguageServerInstallationStatus::Downloading,
                    );
                    zed::download_file(
                        "https://github.com/forcedotcom/salesforcedx-vscode/raw/refs/heads/develop/packages/salesforcedx-vscode-apex/jars/apex-jorje-lsp.jar",
                        "apex-jorje-lsp.jar",
                        zed::DownloadedFileType::Uncompressed,
                    )
                    .map_err(|e| format!("failed to download apex-jorje-lsp.jar: {e}"))?;
                }

                Ok(zed::Command {
                    command: java,
                    args: vec![
                        "-Ddebug.internal.errors=true".into(),
                        "-Ddebug.semantic.errors=false".into(),
                        "-Dlwc.typegeneration.disabled=true".into(),
                        "-jar".into(),
                        jar_path.to_string_lossy().into_owned(),
                    ],
                    env: vec![],
                })
            }

            "lwc" => {
                let node = zed::node_binary_path()?;

                let package_name = "@salesforce/lwc-language-server";
                if zed::npm_package_installed_version(package_name)?.is_none() {
                    let version = zed::npm_package_latest_version(package_name)?;
                    zed::npm_install_package(package_name, &version)?;
                }

                let work_dir = std::env::current_dir()
                    .map_err(|e| format!("could not get extension work directory: {e}"))?;
                let server_path = work_dir
                    .join("node_modules")
                    .join("@salesforce")
                    .join("lwc-language-server")
                    .join("bin")
                    .join("lwc-language-server.js");

                Ok(zed::Command {
                    command: node,
                    args: vec![
                        server_path.to_string_lossy().into_owned(),
                        "--stdio".to_string(),
                    ],
                    env: vec![],
                })
            }

            _ => Err(format!("unknown language server: {language_server_id}")),
        }
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        match language_server_id.as_ref() {
            "apex" => Ok(Some(zed::serde_json::json!({
                "enableSynchronizedInitJobs": true,
                "enableSemanticErrors": false,
                "enableCompletionStatistics": false
            }))),
            _ => Ok(None),
        }
    }
}

zed::register_extension!(SalesforceExtension);
