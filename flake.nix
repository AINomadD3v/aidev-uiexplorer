{
  description = "Development environment for uiautodev";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        python = pkgs.python313;
        pyPkgsBase = python.pkgs;

        # Manual imageio patch
        imageioPatched = pyPkgsBase.buildPythonPackage rec {
          pname = "imageio";
          version = "2.37.0";
          format = "pyproject";
          src = pyPkgsBase.fetchPypi {
            inherit pname version;
            sha256 = "sha256-lGWeA4JHDqx+x0xuEJeOvgNBdB8rhpPC2V62M9pb+zE=";
          };
          propagatedBuildInputs = with pyPkgsBase; [
            numpy
            pillow
            requests
            packaging
          ];
          doCheck = false;
        };

        overlays = final: prev: {
          python313Packages = prev.python313Packages.overrideScope (pyFinal: pyPrev: {
            imageio = imageioPatched;
            pyerfa = pyerfaPatched;
            astropy = astropyPatched;
          });
        };

        pkgsWithOverlay = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [overlays];
        };

        pythonOver = pkgsWithOverlay.python313;
        pyPkgs = pythonOver.pkgs;

        # Patched pytest-doctestplus
        pytest-doctestplus-patched = pyPkgs.buildPythonPackage rec {
          pname = "pytest-doctestplus";
          version = "1.4.0";
          format = "wheel";
          src = pkgsWithOverlay.fetchurl {
            url = "https://files.pythonhosted.org/packages/py3/p/pytest-doctestplus/pytest_doctestplus-1.4.0-py3-none-any.whl";
            sha256 = "sha256-z7rhMOyQ1KKDGBm7v9CXEhuOVfHk0gpH6pkuTqrSU5o=";
          };
          doCheck = false;
          postInstall = ''
            substituteInPlace $out/${pythonOver.sitePackages}/pytest_doctestplus/plugin.py \
              --replace 'obj = inspect.unwrap(obj).__code__' \
                        'if not hasattr(inspect.unwrap(obj), "__code__"): return -1; obj = inspect.unwrap(obj).__code__'
          '';
        };

        astropyPatched = pyPkgs.astropy.overridePythonAttrs (old: {
          propagatedBuildInputs = (old.propagatedBuildInputs or []) ++ [pytest-doctestplus-patched];
          doCheck = false;
        });

        pyerfaPatched = pyPkgs.pyerfa.overridePythonAttrs (old: {
          propagatedBuildInputs = (old.propagatedBuildInputs or []) ++ [pytest-doctestplus-patched];
          doCheck = false;
        });

        # --- Your custom packages ---
        apkutils2Custom = pyPkgs.buildPythonPackage rec {
          pname = "apkutils2";
          version = "1.0.0";
          format = "setuptools";
          src = pyPkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-xa6PhtPr7mpZ/AFNiFB3Qdfz+asYO6s0tE0BH+h4Zgs=";
          };
          propagatedBuildInputs = with pyPkgs; [lxml xmltodict pyelftools pycryptodome];
          postPatch = ''
            printf '%s\n' "class Magic:" "    def __init__(self): pass" "    def load(self): pass" "    def match_buffer(self): pass" > apkutils2/cigam.py
            sed -i 's/from cigam import Magic/from .cigam import Magic/' apkutils2/__init__.py
          '';
          doCheck = false;
        };

        adbutilsCustom = pyPkgs.buildPythonPackage rec {
          pname = "adbutils";
          version = "2.5.0";
          format = "pyproject";
          src = pyPkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-CQa70LCVLNrSmDIFVjRYFsfbaOAmL6eNinsg/ejn+DA=";
          };
          nativeBuildInputs = with pyPkgs; [poetry-core setuptools pbr];
          propagatedBuildInputs = with pyPkgs;
            [
              requests
              deprecation
              whichcraft
              packaging
              retry
              pillow
            ]
            ++ [apkutils2Custom];
          doCheck = false;
        };

        imutilsCustom = pyPkgs.buildPythonPackage rec {
          pname = "imutils";
          version = "0.5.4";
          src = pkgsWithOverlay.fetchurl {
            url = "https://files.pythonhosted.org/packages/source/i/imutils/imutils-${version}.tar.gz";
            sha256 = "094gbnqhyjha5w7wp6f1mq65mwqwb5i4m1600l1m8p4bragpm0h3";
          };
          propagatedBuildInputs = with pyPkgs; [opencv4 numpy scipy matplotlib];
          doCheck = false;
        };

        finditCustom = pyPkgs.buildPythonPackage rec {
          pname = "findit";
          version = "0.5.8";
          format = "setuptools";
          src = pyPkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-qbIbEZSqpno+BH9h2ZbjHz9IxFEtsIL5luU1KqWpGcI=";
          };
          propagatedBuildInputs = with pyPkgs; [opencv4 numpy scikit-image] ++ [imutilsCustom];
          postPatch = ''
            sed -i 's/from skimage.measure import compare_ssim/from skimage.metrics import structural_similarity as compare_ssim/' findit/engine/sim.py
          '';
          doCheck = false;
        };

        uiautomator2Custom = pyPkgs.buildPythonPackage rec {
          pname = "uiautomator2";
          version = "3.2.5";
          format = "pyproject";
          src = pyPkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-jkFGm6IYFG258Drqs3xLvr9lGwrfTmueXS54DCQ4cuM=";
          };
          nativeBuildInputs = with pyPkgs; [poetry-core poetry-dynamic-versioning];
          propagatedBuildInputs = [adbutilsCustom apkutils2Custom finditCustom];
          doCheck = false;
        };

        wdapyCustom = pyPkgs.buildPythonPackage rec {
          pname = "wdapy";
          version = "1.0.0";
          format = "setuptools";
          src = pyPkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-ZxL2Lu1Zch47eDNkdzndBgnQTtnctlbci8e2JQ4vDjM=";
          };
          nativeBuildInputs = with pyPkgs; [pbr];
          propagatedBuildInputs = with pyPkgs; [requests];
          doCheck = false;
        };

        pythonEnv = pythonOver.withPackages (ps:
          with ps; [
            numpy
            packaging
            pytest
            isort
            pytest-cov
            fastapi
            uvicorn
            pydantic
            httpx
            click
            pillow
            poetry-core
            lxml
            construct
            pygments
            uvloop
            httptools
            python-dotenv
            jedi

            adbutilsCustom
            uiautomator2Custom
            wdapyCustom
            python-multipart
          ]);
      in {
        devShells.default = pkgsWithOverlay.mkShell {
          name = "uiautodev-shell";
          packages = [
            pythonEnv
            pkgsWithOverlay.poetry
            pkgsWithOverlay.android-tools
            pkgsWithOverlay.git
          ];
          shellHook = ''
                    # Optional: Clear the screen for a cleaner start (remove if you don't like this)
            # clear

            # Add project source directory to PYTHONPATH for local imports only if it exists
            if [ -d "./uiautodev" ]; then
              export PYTHONPATH="./uiautodev:$PYTHONPATH"
              __uiautodev_path_added=1
            else
              __uiautodev_path_added=0
            fi

            echo ""
            echo "=================================================="
            echo " uiautodev Development Environment Activated"
            echo "=================================================="
            echo ""
            echo "Tools Ready:"
            # Directly use the python path from Nix; execute to get version
            # Use which for other tools, check if found
            echo "  ADB:    $(which adb || echo 'Not found in PATH')"
            echo "  Poetry: $(which poetry || echo 'Not found in PATH')"
            echo ""

            # Report if PYTHONPATH was modified
            echo "Project Setup:"
            if [ $__uiautodev_path_added -eq 1 ]; then
              echo "  PYTHONPATH includes ./uiautodev"
            else
              echo "  Note: ./uiautodev directory not found, not added to PYTHONPATH."
            fi
            unset __uiautodev_path_added # Clean up temporary variable
            echo ""

            echo "To run the uiautodev server:"
            echo "  uvicorn uiautodev.app:app --host 127.0.0.1 --port 20242 --reload"
            echo ""
            echo "Access the server at: http://127.0.0.1:20242"
            echo ""
            echo "=================================================="
            echo ""
          '';
        };
      }
    );
}
