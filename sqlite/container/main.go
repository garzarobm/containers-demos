package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
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

	http.HandleFunc("/_health", func(w http.ResponseWriter, r *http.Request) {
		if terminate {
			w.WriteHeader(400)
			w.Write([]byte("draining"))
			return
		}

		w.Write([]byte("ok"))
	})

	http.HandleFunc("/exec", func(w http.ResponseWriter, r *http.Request) {
		text, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(500)
			return
		}

		cmdString := strings.Split(string(text), " ")
		cmd := exec.Command(cmdString[0], func() []string {
			if len(cmdString) == 1 {
				return []string{}
			}

			return cmdString[1:]
		}()...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			w.WriteHeader(400)
		}

		w.Write([]byte("output: "))
		w.Write(output)
		if err != nil {
			w.Write([]byte{'\n'})
			w.Write([]byte(err.Error()))
		}
	})

	http.HandleFunc("/", handler)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
