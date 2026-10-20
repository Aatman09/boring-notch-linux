UUID = boring-notch-linux@aatman09.github.io
ZIP = dist/$(UUID).shell-extension.zip

.PHONY: pack install clean

pack:
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist \
		--extra-source=src --extra-source=LICENSE .

install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Log out and back in, then run: gnome-extensions enable $(UUID)"

clean:
	rm -rf dist schemas/gschemas.compiled
