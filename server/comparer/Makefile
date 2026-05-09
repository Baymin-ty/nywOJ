# Build the comparer used by judgeWorker.js for type=0 problems.
# The binary is platform-specific and intentionally git-ignored — run
# `make` here once on every new judge machine.

CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++14
TARGET   := comparer
SRC      := comparer.cpp

$(TARGET): $(SRC) testlib.h
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET)

clean:
	rm -f $(TARGET)

.PHONY: clean
