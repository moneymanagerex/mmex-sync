@echo off
node %~dp0\..\..\src\index.js --db=%~dp0\sample_db2.mmb --profile=db_sample_2 %*
