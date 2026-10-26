package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"time"
)

//go:embed site
var assets embed.FS

func main() {
	autoOpen := flag.Bool("open", true, "Open the local workspace in the default browser")
	flag.Parse()
	const address = "127.0.0.1:5178"
	const url = "http://localhost:5178/"
	listener, err := net.Listen("tcp", address)
	if err != nil {
		client := http.Client{Timeout: time.Second}
		response, checkErr := client.Get(url)
		if checkErr == nil {
			defer response.Body.Close()
			if response.Header.Get("X-VIAPP-Server") == "1" {
				if *autoOpen {
					openBrowser(url)
				}
				return
			}
		}
		fmt.Println("VIAPP: 5178 端口被其他程序占用，请关闭占用程序后重试。")
		fmt.Println("按回车退出。")
		fmt.Scanln()
		os.Exit(1)
	}
	site, err := fs.Sub(assets, "site")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(site))
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-VIAPP-Server", "1")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		files.ServeHTTP(w, r)
	})}
	fmt.Printf("VIAPP 已启动：%s\n请用 Chrome / Edge 打开。关闭此窗口或按 Ctrl+C 停止本地服务。\n", url)
	if *autoOpen {
		go func() { time.Sleep(250 * time.Millisecond); openBrowser(url) }()
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	go func() { <-signals; server.Close() }()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Println(err)
		os.Exit(1)
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}
