; 安装时自动安装「臻煞」代码签名证书到用户信任列表
; 之后同一证书签名的所有版本都会被系统信任
!macro customInstall
  DetailPrint '正在安装代码签名证书（臻煞）...'
  File /oname=$PLUGINSDIR\RobotConsole-CA.cer "${BUILD_RESOURCES_DIR}\codesign.cer"
  nsExec::ExecToLog 'certutil -addstore -f Root "$PLUGINSDIR\RobotConsole-CA.cer"'
  nsExec::ExecToLog 'certutil -addstore -f TrustedPublisher "$PLUGINSDIR\RobotConsole-CA.cer"'
  nsExec::ExecToLog 'certutil -user -addstore -f Root "$PLUGINSDIR\RobotConsole-CA.cer"'
  nsExec::ExecToLog 'certutil -user -addstore -f TrustedPublisher "$PLUGINSDIR\RobotConsole-CA.cer"'
!macroend
