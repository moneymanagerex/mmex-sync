@echo off
call %~dp0\mytest_core.bat
start /wait "" "sample_db1.mmb"
call %~dp0\mytest_core.bat
