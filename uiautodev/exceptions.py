class UiautoException(Exception):
    pass


class AndroidDriverException(UiautoException):
    pass


class AppiumDriverException(UiautoException):
    pass


class MethodError(UiautoException):
    pass


class ElementNotFoundError(MethodError):
    pass


class RequestError(UiautoException):
    pass

