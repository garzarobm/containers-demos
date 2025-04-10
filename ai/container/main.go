package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

func handler(w http.ResponseWriter, r *http.Request) {
	country := os.Getenv("CLOUDFLARE_COUNTRY_A2")
	location := os.Getenv("CLOUDFLARE_LOCATION")
	region := os.Getenv("CLOUDFLARE_REGION")

	fmt.Fprintf(w, "Hi, I'm a container running in %s, %s, which is part of %s ", location, country, region)
}

func main() {
	c := make(chan os.Signal, 10)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	terminate := false
	go func() {
		for range c {
			if terminate {
				os.Exit(0)
				continue
			}

			terminate = true
			go func() {
				time.Sleep(time.Minute)
				os.Exit(0)
			}()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /execute", func(w http.ResponseWriter, r *http.Request) {
		cmd := exec.Command("python3")
		cmd.Stdin = r.Body
		b := &bytes.Buffer{}
		cmd.Stdout = b
		if err := cmd.Run(); err != nil {
			w.WriteHeader(400)
		}

		io.Copy(w, b)
	})

	mux.HandleFunc("/_health", func(w http.ResponseWriter, r *http.Request) {
		if terminate {
			w.WriteHeader(400)
			w.Write([]byte("draining"))
			return
		}

		w.Write([]byte("ok"))
	})

	server := &http.Server{
		Addr:    "0.0.0.0:8080",
		Handler: mux,
	}

	log.Fatal(server.ListenAndServe())
}
